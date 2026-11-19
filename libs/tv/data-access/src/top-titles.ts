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
 * first (the "Trending this week" category of Movies and Series). One entry
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
