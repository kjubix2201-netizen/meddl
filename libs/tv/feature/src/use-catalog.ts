import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TvMetadata } from '@meddl/tv/data-access';
import {
    Catalog,
    CatalogSort,
    Category,
    ProviderClient,
    LatestRequest,
    NO_CATEGORY,
    TOP_CATEGORY,
    UserData,
    joinCategories,
    t,
} from '@meddl/tv/util';
import {
    DEFAULT_PREFERRED_REGION,
    orderPreferredRegionFirst,
} from '@meddl/shared/m3u-utils';
import { Route } from './navigation';
import { ALL_COUNTRIES, categoriesOfCountry } from './country-catalog';
import { topCatalog } from './top-catalog';
const empty = (): Catalog => ({ items: [], total: 0, page: 0, categories: [] });
/** One active query survives detail navigation; a new query cancels its append lane. */
export function useCatalog(
    route: Route,
    provider: { current?: ProviderClient },
    ready: number,
    source: string,
    finishFocus: () => void,
    sort: CatalogSort,
    reportConnection: (message: string) => void = () => undefined,
    /** TMDB settings, for "Trending this week" (top-catalog.ts). */
    tmdb?: UserData['tmdb']
) {
    const metadata = useMemo(
        () => (tmdb ? new TvMetadata(tmdb) : undefined),
        [tmdb?.enabled, tmdb?.apiKey, tmdb?.language]
    );
    const active = ['movies', 'series', 'search', 'live'].includes(route.view);
    const key = JSON.stringify([
        source,
        route.kind,
        route.category,
        route.query,
        route.country,
        sort,
        ready,
    ]);
    const [state, setState] = useState({
        key: '',
        catalog: empty(),
        busy: false,
        error: '',
        more: false,
    });
    const lane = useRef(new LatestRequest());
    const snapshot = useRef(state);
    snapshot.current = state;
    const request = useRef(false);
    // Full category list per source and kind, to scope requests to a country.
    const categoryCache = useRef(new Map<string, Category[]>());
    const latest = useRef({
        key,
        route,
        provider,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
        source,
        metadata,
    });
    latest.current = {
        key,
        route,
        provider,
        ready,
        active,
        finishFocus,
        sort,
        reportConnection,
        source,
        metadata,
    };
    async function load(append: boolean) {
        const current = latest.current;
        if (
            !current.active ||
            !current.ready ||
            !current.provider.current ||
            request.current
        )
            return;
        const previous = snapshot.current;
        const page =
            append && previous.key === current.key
                ? previous.catalog.page + 1
                : 0;
        const job = lane.current.start();
        request.current = true;
        setState((s) => ({ ...s, busy: true, error: '' }));
        try {
            const client = current.provider.current;
            const { kind, country } = current.route;
            const cacheKey = `${current.source}|${current.ready}|${kind}`;
            let category = current.route.category;
            let scoped: Category[] | undefined;
            let all: Category[] | undefined;
            if (country && country !== ALL_COUNTRIES) {
                all = categoryCache.current.get(cacheKey);
                if (!all) {
                    all = (
                        await client.catalog(kind, '', 0, '', job.signal, current.sort)
                    ).categories;
                    categoryCache.current.set(cacheKey, all);
                }
                if (!lane.current.owns(job)) return;
                scoped = categoriesOfCountry(all, country);
                const ids = scoped.map((c) => c.id);
                // Without multi-category support (Stalker) a country opens
                // at its first category.
                if (!category)
                    category = client.capabilities.multiCategory
                        ? joinCategories(ids)
                        : (ids[0] ?? NO_CATEGORY);
            }
            const top = category === TOP_CATEGORY;
            const result = top
                ? await topCatalog(
                      client,
                      current.metadata,
                      current.source,
                      kind,
                      current.route.query,
                      scoped,
                      job.signal,
                      current.sort
                  )
                : await client.catalog(
                      kind,
                      category,
                      page,
                      current.route.query,
                      job.signal,
                      current.sort
                  );
            if (!lane.current.owns(job) || current.key !== latest.current.key)
                return;
            if (!scoped) categoryCache.current.set(cacheKey, result.categories);
            const items = page ? [...previous.catalog.items] : [];
            const seen = new Set(items.map((x) => x.id));
            result.items.forEach((item) => {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    items.push(item);
                }
            });
            const progressed =
                page === 0 || items.length > previous.catalog.items.length;
            const next = {
                key: current.key,
                catalog: {
                    ...result,
                    items,
                    // Categories of the viewer's region (Germany) come first,
                    // as in the desktop app's "Show my region first" setting.
                    categories: orderPreferredRegionFirst(
                        scoped ?? result.categories,
                        DEFAULT_PREFERRED_REGION,
                        (category) => category.name
                    ) as typeof result.categories,
                    allCategories: all ?? result.categories,
                },
                busy: false,
                error: '',
                more:
                    progressed &&
                    result.items.length > 0 &&
                    (page + 1) * (result.pageSize || 60) < result.total,
            };
            snapshot.current = next;
            setState(next);
            current.reportConnection('');
            if (!page) current.finishFocus();
        } catch {
            if (lane.current.owns(job)) {
                // The trending list comes from TMDB: its failure says nothing
                // about the connection to the source.
                const top = current.route.category === TOP_CATEGORY;
                if (!append && !top)
                    current.reportConnection(
                        t('Could not load titles. Check the connection and retry.')
                    );
                setState((s) => ({
                    ...s,
                    busy: false,
                    error: top
                        ? t('The trending list could not be loaded. Check the TMDB key and the connection.')
                        : t('Could not load titles. Check the connection and retry.'),
                }));
            }
        } finally {
            if (lane.current.owns(job)) request.current = false;
        }
    }
    useEffect(() => {
        lane.current.cancel();
        request.current = false;
        if (!active || !ready) return;
        if (
            snapshot.current.key === key &&
            snapshot.current.catalog.items.length
        ) {
            setState((s) => ({ ...s, busy: false }));
            finishFocus();
            return;
        }
        const initial = {
            key,
            catalog: empty(),
            busy: true,
            error: '',
            more: false,
        };
        snapshot.current = initial;
        setState(initial);
        const timer = setTimeout(() => void load(false), route.query ? 180 : 0);
        return () => {
            clearTimeout(timer);
            lane.current.cancel();
            request.current = false;
        };
    }, [key, active]);
    return {
        catalog: state.key === key ? state.catalog : empty(),
        catalogBusy: active && state.busy,
        catalogError: state.key === key ? state.error : '',
        hasMore: state.key === key && state.more,
        loadMore: () => void load(snapshot.current.catalog.items.length > 0),
        catalogKey: key,
    };
}
