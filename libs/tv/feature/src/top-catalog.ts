import { findTopTitles, type TvMetadata } from '@meddl/tv/data-access';
import {
    Catalog,
    CatalogSort,
    Category,
    Kind,
    Media,
    ProviderClient,
    TOP_CATEGORY,
    UserData,
    catalogTitleMatcher,
    categoryFilter,
    joinCategories,
} from '@meddl/tv/util';

/** The list needs the viewer's TMDB key (Settings → TMDB). */
export function topListAvailable(kind: Kind, tmdb: UserData['tmdb']) {
    return (kind === 'movie' || kind === 'series') && tmdb.enabled && !!tmdb.apiKey.trim();
}

/** Movies and Series open with the trending list when there is one, else with all categories. */
export function startCategory(kind: Kind, tmdb: UserData['tmdb']) {
    return topListAvailable(kind, tmdb) ? TOP_CATEGORY : '';
}

type Trending = Awaited<ReturnType<TvMetadata['trending']>>;
// Matched once per connection, section and country; typing in the search
// box or coming back from a title must not compare the whole list again.
const matched = new WeakMap<ProviderClient, Map<string, { trending: Trending; items: Media[] }>>();

/**
 * "Trending this week": TMDB's trending titles of the last days that the
 * source offers (in the chosen country's categories), most popular first,
 * as one page. Categories and counts are those of "All categories".
 */
export async function topCatalog(
    client: ProviderClient,
    metadata: TvMetadata | undefined,
    sourceId: string,
    kind: Kind,
    query: string,
    scoped: Category[] | undefined,
    signal: AbortSignal,
    sort: CatalogSort
): Promise<Catalog> {
    const base = await client.catalog(kind, '', 0, '', signal, sort);
    let items: Media[] = [];
    if (metadata && (kind === 'movie' || kind === 'series')) {
        const trending = await metadata.trending(kind, signal);
        const key = `${kind}|${scoped ? scoped.map((c) => c.id).join('\u001f') : '*'}`;
        const lists = matched.get(client) ?? new Map<string, { trending: Trending; items: Media[] }>();
        matched.set(client, lists);
        const kept = lists.get(key);
        if (kept?.trending === trending) items = kept.items;
        else {
            const inCountry = scoped ? categoryFilter(joinCategories(scoped.map((c) => c.id))) : undefined;
            items = await findTopTitles(
                client,
                sourceId,
                kind,
                trending,
                signal,
                inCountry ? (item) => inCountry(item.category) : undefined
            );
            lists.set(key, { trending, items });
        }
    }
    const matchesTitle = catalogTitleMatcher(query);
    const shown = query ? items.filter((item) => matchesTitle(item.title)) : items;
    return { ...base, items: shown, total: shown.length, page: 0, pageSize: Math.max(60, shown.length) };
}
