import {
    XtreamClient,
    xtreamCatalogTimestamp,
    resolveXtreamVodPlaybackSource,
} from '@meddl/portal/xtream/client';
import {
    Catalog,
    CatalogSort,
    Category,
    sortCatalog,
    catalogTitleMatcher,
    categoryFilter,
    countByCategory,
    Kind,
    Media,
    Source,
    ProviderClient,
    rows,
    text,
    artwork,
    identity,
    withSeriesContext,
} from '@meddl/tv/util';
import type { XtreamVodDetails } from '@meddl/shared/interfaces';
import { ProviderTransport } from './transport';
/** Xtream category rows from an array or an object map of rows. */
function categoryRows(payload: unknown): Category[] {
    const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object'
          ? Object.values(payload as Record<string, unknown>)
          : [];
    return rows(list)
        .filter((r) => r.category_id != null && text(r.category_id) !== '')
        .map((r) => ({ id: text(r.category_id), name: text(r.category_name) }));
}

export class XtreamProvider implements ProviderClient {
    readonly capabilities = {
        live: true,
        movies: true,
        series: true,
        epg: true,
        multiCategory: true,
    };
    private client: XtreamClient;
    private catalogs = new Map<string, Record<string, unknown>[]>();
    // Category lists change rarely; one request per section and session.
    private categoryLists = new Map<string, Category[]>();
    constructor(
        private source: Source,
        transport: ProviderTransport
    ) {
        this.client = new XtreamClient(source, (params, signal) =>
            transport.request(source, 'xtream', params, signal)
        );
    }
    async connect(signal: AbortSignal) {
        await this.client.account(signal);
        return this.source;
    }
    private media(raw: Record<string, unknown>, kind: Kind): Media {
        const providerId = text(
            kind === 'series' ? raw.series_id : (raw.stream_id ?? raw.id)
        );
        return {
            id: identity(this.source, kind, providerId),
            sourceId: this.source.id,
            providerId,
            kind,
            title: text(raw.name ?? raw.title),
            addedAt: xtreamCatalogTimestamp(raw, kind === 'series'),
            poster: artwork(raw.stream_icon ?? raw.cover),
            category: text(raw.category_id),
            backdrop: artwork(
                Array.isArray(raw.backdrop_path)
                    ? raw.backdrop_path[0]
                    : raw.backdrop_path
            ),
            description: text(raw.plot ?? raw.description),
            year: text(raw.year ?? raw.releaseDate),
            raw,
        };
    }
    async catalog(
        kind: Kind,
        category: string,
        page: number,
        query: string,
        signal: AbortSignal,
        sort: CatalogSort = 'recent'
    ): Promise<Catalog> {
        const type = kind === 'movie' ? 'vod' : kind;
        const key = type;
        let data = this.catalogs.get(key);
        if (!data) {
            data = await this.fullList(kind === 'series' ? 'get_series' : `get_${type}_streams`, type, signal);
            // An empty answer is often a busy or throttled panel: ask again later.
            if (!signal.aborted && data.length) this.catalogs.set(key, data);
        }
        let categories = this.categoryLists.get(type);
        if (!categories) {
            categories = await this.loadCategories(type, signal);
            if (!signal.aborted && categories.length) this.categoryLists.set(type, categories);
        }
        const matchesTitle = catalogTitleMatcher(query);
        const inCategory = categoryFilter(category);
        const all = data.map((r) => this.media(r, kind));
        const items = all.filter(
            (m) => inCategory(m.category) && matchesTitle(m.title)
        );
        return {
            items: sortCatalog(
                items,
                kind === 'live' ? 'provider' : sort
            ).slice(page * 60, (page + 1) * 60),
            total: items.length,
            page,
            categories,
            categoryCounts: countByCategory(all),
        };
    }
    /**
     * The whole section in one request. Some panels never finish that answer
     * (or cut it off); the list is then built category by category, like
     * other players do, so the section still loads.
     */
    private async fullList(action: string, type: string, signal: AbortSignal): Promise<Record<string, unknown>[]> {
        try {
            const all = rows(await this.client.request(action, {}, signal));
            if (all.length || signal.aborted) return all;
        } catch (error) {
            if (signal.aborted) throw error;
        }
        const categories = await this.loadCategories(type, signal);
        const merged: Record<string, unknown>[] = [];
        for (const category of categories) {
            if (signal.aborted) break;
            try {
                merged.push(...rows(await this.client.request(action, { category_id: category.id }, signal)));
            } catch (error) {
                if (signal.aborted) throw error;
            }
        }
        return merged;
    }
    /**
     * Category list of one section. Some panels answer it as an object map
     * instead of an array, and busy panels answer it empty right after a
     * large stream list: such answers are asked again, up to three times.
     */
    private async loadCategories(type: string, signal: AbortSignal): Promise<Category[]> {
        for (let attempt = 1; ; attempt++) {
            const list = categoryRows(
                await this.client.request(`get_${type}_categories`, {}, signal)
            );
            if (list.length || attempt >= 3 || signal.aborted) return list;
            await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
        }
    }
    async details(item: Media, signal: AbortSignal): Promise<Media> {
        if (item.kind === 'episode') return item;
        const result = (await this.client.request(
            item.kind === 'series' ? 'get_series_info' : 'get_vod_info',
            {
                [item.kind === 'series' ? 'series_id' : 'vod_id']:
                    item.providerId,
            },
            signal
        )) as Record<string, unknown>;
        const info = (result.info ?? {}) as Record<string, unknown>;
        return {
            ...item,
            raw: { ...item.raw, details: result },
            description: text(info.plot ?? info.description),
            year: text(info.releasedate ?? info.releaseDate),
            poster: artwork(info.movie_image ?? info.cover) ?? item.poster,
            backdrop: artwork(
                Array.isArray(info.backdrop_path)
                    ? info.backdrop_path[0]
                    : info.backdrop_path
            ),
        };
    }
    async episodes(item: Media, signal: AbortSignal): Promise<Media[]> {
        const detail = item.raw.details
            ? item
            : await this.details(item, signal);
        const data = detail.raw.details as {
            episodes?: Record<string, unknown>;
        };
        const result: Media[] = [];
        Object.keys(data.episodes ?? {}).forEach((season) =>
            rows(data.episodes?.[season]).forEach((r) => {
                const providerId = text(r.id);
                const info = (r.info ?? {}) as Record<string, unknown>;
                result.push(
                    withSeriesContext(
                        {
                            ...this.media(r, 'episode'),
                            id: identity(
                                this.source,
                                'episode',
                                `${item.providerId}:${season}:${providerId}`
                            ),
                            providerId,
                            parentId: item.id,
                            seriesTitle: item.title,
                            seriesYear: item.year,
                            poster: detail.poster || item.poster,
                            episodeStill: artwork(info.movie_image),
                            description: text(info.plot ?? info.description),
                            backdrop: detail.backdrop,
                            season: Number(r.season ?? season),
                            episode: Number(r.episode_num),
                            title: text(r.title) || `Episode ${r.episode_num}`,
                            raw: r,
                        },
                        detail
                    )
                );
            })
        );
        return result;
    }
    async epg(item: Media, signal: AbortSignal) {
        return (await this.client.epg(item.providerId, signal)).map((p) => ({
            title: p.title,
            description: p.description,
            start: Date.parse(p.start),
            end: Date.parse(p.stop),
        }));
    }
    async resolve(item: Media, signal: AbortSignal) {
        if (item.kind === 'live')
            return {
                url: this.client.stream(
                    'live',
                    item.providerId,
                    this.client.formats.includes('m3u8') ||
                        !this.client.formats.length
                        ? 'm3u8'
                        : this.client.formats[0]
                ),
            };
        if (item.kind === 'episode')
            return {
                url: this.client.stream(
                    'series',
                    item.providerId,
                    text(item.raw.container_extension)
                ),
            };
        let source =
            resolveXtreamVodPlaybackSource(
                item.raw.details as XtreamVodDetails
            ) ??
            resolveXtreamVodPlaybackSource({
                movie_data: item.raw,
            } as unknown as XtreamVodDetails);
        if (!source) {
            const detail = await this.details(item, signal);
            source = resolveXtreamVodPlaybackSource(
                detail.raw.details as XtreamVodDetails
            );
        }
        if (!source)
            throw new Error(
                'This movie has no complete stream ID and file extension or direct address.'
            );
        return {
            url:
                source.directSource ??
                this.client.stream(
                    'movie',
                    source.streamId,
                    source.containerExtension
                ),
        };
    }
    dispose() {
        this.catalogs.clear();
    }
}
