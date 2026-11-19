import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    Kind,
    CatalogSortPreferences,
    LatestRequest,
    Media,
    Program,
    ProviderClient, t } from '@meddl/tv/util';
import { restoreFocus } from '@meddl/tv/ui';
import type { Route } from './navigation';
import { useCatalog } from './use-catalog';
export function useContent(
    route: Route,
    provider: { current?: ProviderClient },
    ready: number,
    selected: Media | undefined,
    setSelected: (m: Media) => void,
    epgEnabled: boolean,
    setError: (s: string) => void,
    pendingFocus: { current: string },
    sourceId: string,
    pendingScroll: { current?: number },
    sorts: CatalogSortPreferences
) {
    const key = JSON.stringify([
        sourceId,
        route.view,
        route.kind,
        route.category,
        route.page,
        route.query,
        route.item?.id,
        ready,
    ]);
    const [homeState, setHomeState] = useState<{ key: string; value: Media[] }>(
        { key: '', value: [] }
    );
    const home = homeState.key === key ? homeState.value : [];
    const setHome = (value: Media[]) => setHomeState({ key, value });
    // Titles per section for the home tiles; read from the same catalog
    // requests the home rails already make, so no extra provider traffic.
    const [countState, setCountState] = useState<{
        key: string;
        value: Partial<Record<Kind, number>>;
    }>({ key: '', value: {} });
    const homeCounts = countState.key === key ? countState.value : {};
    const [episodes, setEpisodes] = useState<Media[]>([]);
    const [guideState, setGuideState] = useState<{
        id?: string;
        programs: Program[];
    }>({ programs: [] });
    const epg = guideState.id === selected?.id ? guideState.programs : [];
    const setEpg = (programs: Program[]) =>
        setGuideState({ id: selected?.id, programs });
    const [epgError, setEpgError] = useState('');
    const [busy, setBusy] = useState(false);
    const browse = useRef(new LatestRequest());
    const guide = useRef(new LatestRequest());
    const finishFocus = () => {
        if (!pendingFocus.current) return;
        restoreFocus(
            pendingFocus.current,
            'first-content',
            pendingScroll.current
        );
        pendingFocus.current = '';
        pendingScroll.current = undefined;
    };
    const report = () =>
        setError(
            t('The request failed. Check your source and backend, then retry.')
        );
    useLayoutEffect(() => {
        const client = provider.current;
        const lane = browse.current;
        const job = lane.start();
        setEpisodes([]);
        if (
            !ready ||
            !client ||
            !['home', 'detail'].includes(route.view) ||
            (route.view === 'detail' && route.item?.sourceId !== sourceId)
        ) {
            setBusy(false);
            if (['favorites', 'sources', 'settings'].includes(route.view)) finishFocus();
            return;
        }
        setBusy(true);
        const load = async () => {
            if (route.view === 'home') {
                let failed = 0;
                const counts: Partial<Record<Kind, number>> = {};
                // Live first: the films' and series' big lists open in the
                // background once the remote rests (CachedProvider.warm), and
                // their rows join Home then instead of slowing the start.
                const live = await client.catalog('live', '', 0, '', job.signal).catch(() => undefined);
                if (live && lane.owns(job) && client.warmed) {
                    counts.live = live.total;
                    setHome(live.items.slice(0, 12));
                    setCountState({ key, value: { live: live.total } });
                    setBusy(false);
                    finishFocus();
                }
                await Promise.all(
                    (['movie', 'series'] as Kind[]).map((kind) => client.warmed?.(kind) ?? Promise.resolve())
                );
                if (!lane.owns(job)) return;
                const lists = await Promise.all(
                    (['movie', 'series', 'live'] as Kind[]).map((kind) =>
                        client
                            .catalog(kind, '', 0, '', job.signal)
                            .then((c) => {
                                counts[kind] = c.total;
                                return c.items.slice(0, 12);
                            })
                            .catch(() => {
                                failed++;
                                return [];
                            })
                    )
                );
                if (failed === 3) throw new Error(t('Catalog unavailable'));
                if (lane.owns(job)) {
                    const items = [...lists[0], ...lists[1], ...lists[2]];
                    setHome(items);
                    setCountState({ key, value: counts });
                    // Catalog rows often have only posters. Fill the featured
                    // title's actual provider backdrop without holding the page.
                    const hero = items.find((item) => item.kind === 'movie');
                    if (hero)
                        void client
                            .details(hero, job.signal)
                            .then((detail) => {
                                if (lane.owns(job))
                                    setHome(
                                        items.map((item) =>
                                            item.id === detail.id
                                                ? detail
                                                : item
                                        )
                                    );
                            })
                            .catch(() => undefined);
                }
            } else if (route.view === 'detail' && route.item) {
                const detail = await client.details(route.item, job.signal);
                if (lane.owns(job)) setSelected(detail);
                if (detail.kind === 'series') {
                    const items = await client.episodes(detail, job.signal);
                    if (lane.owns(job)) setEpisodes(items);
                }
            }
        };
        const timer = setTimeout(
            () => {
                void load()
                    .then(() => {
                        if (lane.owns(job)) setError('');
                    })
                    .catch(() => {
                        if (lane.owns(job)) report();
                    })
                    .finally(() => {
                        if (lane.owns(job)) {
                            setBusy(false);
                            finishFocus();
                        }
                    });
            },
            route.query ? 180 : 0
        );
        return () => {
            clearTimeout(timer);
            lane.cancel();
        };
    }, [
        route.view,
        route.kind,
        route.category,
        route.page,
        route.query,
        route.item?.id,
        ready,
        sourceId,
    ]);
    useEffect(() => {
        const lane = guide.current;
        const job = lane.start();
        setEpg([]);
        setEpgError('');
        if (!epgEnabled || selected?.kind !== 'live' || !provider.current)
            return;
        const client = provider.current;
        const timer = setTimeout(() => {
            void client
                .epg(selected, job.signal)
                .then((programs) => {
                    if (lane.owns(job)) setEpg(programs);
                })
                .catch(() => {
                    if (lane.owns(job))
                        setEpgError(
                            t('Programme information is unavailable. Playback remains available.')
                        );
                });
        }, 180);
        return () => {
            clearTimeout(timer);
            lane.cancel();
        };
    }, [selected?.id, epgEnabled, ready]);
    const catalog = useCatalog(
        route,
        provider,
        ready,
        sourceId,
        finishFocus,
        route.kind === 'movie' || route.kind === 'series'
            ? sorts[route.kind]
            : 'provider',
        setError
    );
    return {
        ...catalog,
        finishFocus,
        cancelBrowse: () => browse.current.cancel(),
        home,
        homeCounts,
        episodes,
        epg,
        epgError,
        busy: busy || catalog.catalogBusy,
    };
}
