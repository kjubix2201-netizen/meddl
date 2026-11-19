import { findNewTopTitles, findTopTitles, type TvMetadata } from '@meddl/tv/data-access';
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

type Settings = Pick<UserData, 'tmdb' | 'sources' | 'activeId'>;

/** A TMDB key that is switched on (Settings → Metadata · TMDB). */
export function tmdbReady(tmdb: UserData['tmdb']) {
    return tmdb.enabled && !!tmdb.apiKey.trim();
}

/**
 * Movies and Series have the list with a TMDB key (what is popular now) and,
 * without one, from the source's own dates and ratings. A plain playlist has
 * neither, so there it needs the key.
 */
export function topListAvailable(kind: Kind, data: Settings) {
    if (kind !== 'movie' && kind !== 'series') return false;
    const source = data.sources.find((s) => s.id === data.activeId);
    return tmdbReady(data.tmdb) || (!!source && source.provider !== 'm3u');
}

/** Movies and Series open with the top list when there is one, else with all categories. */
export function startCategory(kind: Kind, data: Settings) {
    return topListAvailable(kind, data) ? TOP_CATEGORY : '';
}

type Trending = Awaited<ReturnType<TvMetadata['trending']>>;
/** No key, or TMDB did not answer: the source's own list is shown. */
const NO_TRENDS: Trending = [];
// Put together once per connection, section and country; typing in the
// search box or coming back from a title must not go through the whole list
// again.
const kept = new WeakMap<ProviderClient, Map<string, { trending: Trending; items: Media[] }>>();

/**
 * "Top of the last days" as one page. With a TMDB key: TMDB's trending
 * titles of the last days that the source offers (in the chosen country's
 * categories), most popular first. Without one, when TMDB does not answer,
 * or when none of its titles are here: what the source added lately, its
 * best rated first. Categories and counts are those of "All categories".
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
    if (kind === 'movie' || kind === 'series') {
        const trending = metadata
            ? await metadata.trending(kind, signal).catch((error: unknown) => {
                  if (signal.aborted) throw error;
                  return NO_TRENDS;
              })
            : NO_TRENDS;
        const key = `${kind}|${scoped ? scoped.map((c) => c.id).join('\u001f') : '*'}`;
        const lists = kept.get(client) ?? new Map<string, { trending: Trending; items: Media[] }>();
        kept.set(client, lists);
        const list = lists.get(key);
        if (list?.trending === trending) items = list.items;
        else {
            const inCountry = scoped ? categoryFilter(joinCategories(scoped.map((c) => c.id))) : undefined;
            const allowed = inCountry ? (item: Media) => inCountry(item.category) : undefined;
            if (trending.length) items = await findTopTitles(client, sourceId, kind, trending, signal, allowed);
            if (!items.length) items = await findNewTopTitles(client, sourceId, kind, signal, allowed);
            lists.set(key, { trending, items });
        }
    }
    const matchesTitle = catalogTitleMatcher(query);
    const shown = query ? items.filter((item) => matchesTitle(item.title)) : items;
    return { ...base, items: shown, total: shown.length, page: 0, pageSize: Math.max(60, shown.length) };
}
