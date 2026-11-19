import { normalizeTitleKeys } from '@meddl/shared/interfaces';
import type { ActorFilmographyCredit } from '@meddl/shared/tmdb';
import type { Media, ProviderClient } from '@meddl/tv/util';
import { findFilmographyTitle, matchScore } from './filmography-search';

/** Without the whole list on this device every title costs the portal a search. */
const SEARCH_LIMIT = 20;
/** Titles compared in one go before the TV's thread gets a turn again. */
const SLICE = 1500;

const aborted = () => new DOMException('Aborted', 'AbortError');

/**
 * The titles of TMDB's trending list that this source offers, most popular
 * first (the "Top of the last days" category of Movies and Series). One entry
 * per trending title: the best match by title and year, the first of equals.
 * A title may come several times in `trending`, once per language's name.
 * `allowed` narrows the source's titles (the chosen country's categories).
 */
export async function findTopTitles(
    provider: ProviderClient,
    sourceId: string,
    kind: 'movie' | 'series',
    trending: readonly ActorFilmographyCredit[],
    signal: AbortSignal,
    allowed: (item: Media) => boolean = () => true
): Promise<Media[]> {
    if (!trending.length) return [];
    const all = await provider.titles?.(kind, signal);
    if (signal.aborted) throw aborted();
    const found = all
        ? await matchList(all, sourceId, kind, trending, signal, allowed)
        : await searchEach(provider, sourceId, trending, signal, allowed);
    const seen = new Set<string>();
    return trending
        .map((credit) => found.get(credit.tmdbId))
        .filter((item): item is Media => !!item && !seen.has(item.id) && !!seen.add(item.id));
}

/** The whole list is here: one pass over it, compared by normalized title. */
async function matchList(
    all: readonly Media[],
    sourceId: string,
    kind: 'movie' | 'series',
    trending: readonly ActorFilmographyCredit[],
    signal: AbortSignal,
    allowed: (item: Media) => boolean
) {
    const wanted = new Map<string, ActorFilmographyCredit[]>();
    for (const credit of trending)
        for (const title of new Set([credit.title, credit.originalTitle])) {
            const key = title ? normalizeTitleKeys(title).exact : '';
            if (key) wanted.set(key, [...(wanted.get(key) ?? []), credit]);
        }
    const best = new Map<number, { item: Media; score: number }>();
    for (let index = 0; index < all.length; index++) {
        if (index && index % SLICE === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (signal.aborted) throw aborted();
        }
        const item = all[index];
        if (item.sourceId !== sourceId || item.kind !== kind) continue;
        const keys = normalizeTitleKeys(item.title);
        const credits = [
            ...(wanted.get(keys.exact) ?? []),
            ...(keys.base !== keys.exact ? (wanted.get(keys.base) ?? []) : []),
        ];
        if (!credits.length || !allowed(item)) continue;
        for (const credit of credits) {
            const score = matchScore(item, credit);
            const held = best.get(credit.tmdbId);
            if (score !== null && (!held || score > held.score)) best.set(credit.tmdbId, { item, score });
        }
    }
    return new Map([...best].map(([id, hit]) => [id, hit.item]));
}

/** The portal only answers searches (Stalker): the first titles, one search each. */
async function searchEach(
    provider: ProviderClient,
    sourceId: string,
    trending: readonly ActorFilmographyCredit[],
    signal: AbortSignal,
    allowed: (item: Media) => boolean
) {
    const found = new Map<number, Media>();
    const titles = [...new Set(trending.map((credit) => credit.tmdbId))].slice(0, SEARCH_LIMIT);
    for (const credit of trending) {
        // The same title under another language's name: only while it is missing.
        if (!titles.includes(credit.tmdbId) || found.has(credit.tmdbId)) continue;
        if (signal.aborted) throw aborted();
        try {
            const match = await findFilmographyTitle(provider, sourceId, credit, signal);
            const items = match.status === 'found' ? [match.item] : match.status === 'choices' ? match.items : [];
            const item = items.find(allowed);
            if (item) found.set(credit.tmdbId, item);
        } catch (error) {
            // One unanswered search leaves this title out, not the whole list.
            if (signal.aborted) throw error;
        }
    }
    return found;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** "New": added within this many days … */
const NEW_DAYS = 14;
/** … or, when the source added less than a list's worth, its newest titles. */
const NEWEST = 200;
const TOP_LIMIT = 40;

/** The source's own rating of a title (0 to 10); 0 when it gives none. */
function sourceRating(item: Media): number {
    for (const value of [item.raw.rating, item.raw.rating_imdb, item.raw.rating_kinopoisk]) {
        const rating = Number(value);
        if (Number.isFinite(rating) && rating > 0) return Math.min(rating, 10);
    }
    const ofFive = Number(item.raw.rating_5based);
    return Number.isFinite(ofFive) && ofFive > 0 ? Math.min(ofFive * 2, 10) : 0;
}

/** Best rated first; equals stay in their order (explicit: old TVs sort unstably). */
function bestRated(items: readonly Media[]): Media[] {
    return items
        .map((item, index) => ({ item, index, rating: sourceRating(item) }))
        .sort((a, b) => b.rating - a.rating || a.index - b.index)
        .map(({ item }) => item);
}

/**
 * The same category without TMDB (no key, not reachable, or none of its
 * titles here): what the source added in the last days, its best rated
 * first, from the source's own dates and ratings. A source that adds little
 * shows the best of its newest titles; one without dates the best rated; one
 * with neither (a plain playlist) nothing.
 */
export async function findNewTopTitles(
    provider: ProviderClient,
    sourceId: string,
    kind: 'movie' | 'series',
    signal: AbortSignal,
    allowed: (item: Media) => boolean = () => true,
    now = Date.now()
): Promise<Media[]> {
    const mine = (item: Media) => item.sourceId === sourceId && item.kind === kind && allowed(item);
    const all = await provider.titles?.(kind, signal);
    if (signal.aborted) throw aborted();
    let newest: Media[];
    if (all) {
        const offered = all.filter(mine);
        const dated = offered
            .filter((item) => !!item.addedAt)
            .map((item, index) => ({ item, index }))
            .sort((a, b) => (b.item.addedAt ?? 0) - (a.item.addedAt ?? 0) || a.index - b.index)
            .map(({ item }) => item);
        const since = now - NEW_DAYS * DAY_MS;
        const fresh = dated.filter((item) => (item.addedAt ?? 0) >= since);
        newest =
            fresh.length >= TOP_LIMIT
                ? fresh
                : dated.length
                  ? dated.slice(0, NEWEST)
                  : offered.filter((item) => sourceRating(item) > 0);
    } else {
        // The portal sorts by date itself: its first pages are its newest titles.
        newest = [];
        for (const page of [0, 1]) {
            const catalog = await provider.catalog(kind, '', page, '', signal, 'recent');
            if (signal.aborted) throw aborted();
            newest.push(...catalog.items.filter(mine));
            if (!catalog.items.length || (page + 1) * (catalog.pageSize || 60) >= catalog.total) break;
        }
    }
    const seen = new Set<string>();
    return bestRated(newest)
        .filter((item) => !seen.has(item.id) && !!seen.add(item.id))
        .slice(0, TOP_LIMIT);
}
