import { storedMediaPoster } from '@meddl/tv/data-access';
import { CatalogOrder, CatalogSortNotice } from './catalog-order';
import { Empty, VirtualCollection, Poster, ResumeCard } from '@meddl/tv/ui';
import { Media, Progress, t } from '@meddl/tv/util';
import { HomeLauncher } from './home-launcher';
import { HomePortrait } from './home-portrait';
import { TvModel } from './use-tv';
import { recentChannels } from './recent-channels';
export function Home({ tv, history }: { tv: TvModel; history: Progress[] }) {
    const items = tv.home;
    const sourceId = tv.data.activeId;
    const rails: [string, Media[]][] = [
        [t('Recently watched channels'), recentChannels(sourceId)],
        [
            t('Favorite channels'),
            tv.data.favorites
                .filter((m) => m.sourceId === sourceId && m.kind === 'live')
                .slice(0, 8),
        ],
        [t('Movies from your source'), items.filter((m) => m.kind === 'movie')],
        [t('Series from your source'), items.filter((m) => m.kind === 'series')],
        [t('On TV now'), items.filter((m) => m.kind === 'live')],
    ];
    return (
        <>
            <HomePortrait />
            <HomeLauncher tv={tv} />
            {history.length ? (
                <section>
                    <h2>{t('Continue watching')}</h2>
                    <div class="rail">
                        {history.map((p) => (
                            <ResumeCard
                                key={p.item.id}
                                progress={p}
                                play={tv.play}
                                poster={storedMediaPoster(
                                    p.item,
                                    tv.data.sources.find(
                                        (s) => s.id === p.item.sourceId
                                    ),
                                    [...tv.home, ...tv.data.favorites]
                                )}
                            />
                        ))}
                    </div>
                </section>
            ) : null}
            {rails
                .filter(([, list]) => list.length)
                .map(([title, list]) => (
                    <section>
                        <h2>{title}</h2>
                        <div class="rail">
                            {list.map((item) => (
                                <Poster
                                    key={item.id}
                                    item={item}
                                    open={tv.open}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            {!tv.busy && !items.length && tv.data.sources.length ? (
                <Empty>
                    {t('This source has no titles available here. Browse TV or check your source.')}
                </Empty>
            ) : null}
        </>
    );
}
export function CatalogScreen({ tv }: { tv: TvModel }) {
    const r = tv.route;
    const list = tv.catalog.items;
    return (
        <>
            <div class="catalog-filters">
                <label>
                    {t('Search this source')}
                    <input
                        type="search"
                        aria-label={t('Search this source')}
                        value={r.query}
                        onInput={(e) =>
                            tv.setRoute({
                                ...r,
                                query: e.currentTarget.value,
                                page: 0,
                            })
                        }
                    />
                </label>
                {r.view === 'search' ? (
                    <label>
                        {t('Content')}
                        <select
                            aria-label={t('Content type')}
                            value={r.kind}
                            onChange={(e) =>
                                tv.setRoute({
                                    ...r,
                                    kind: e.currentTarget
                                        .value as typeof r.kind,
                                    page: 0,
                                    category: '',
                                })
                            }
                        >
                            <option value="movie">{t('Movies')}</option>
                            <option value="series">{t('Series')}</option>
                            <option value="live">{t('Live TV')}</option>
                        </select>
                    </label>
                ) : null}
                <label>
                    {t('Category')}
                    <select
                        data-focus="catalog:category"
                        value={r.category}
                        onChange={(e) =>
                            tv.setRoute({
                                ...r,
                                category: e.currentTarget.value,
                                page: 0,
                            })
                        }
                    >
                        <option value="">{t('All categories')}</option>
                        {tv.catalog.categories.map((c) => (
                            <option value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </label>
                {r.kind === 'movie' || r.kind === 'series' ? (
                    <CatalogOrder tv={tv} kind={r.kind} />
                ) : null}
            </div>
            <CatalogSortNotice tv={tv} />
            <VirtualCollection
                key={tv.catalogKey}
                layout={r.kind === 'live' ? 'stations' : 'posters'}
                items={list}
                more={tv.hasMore}
                busy={tv.catalogBusy}
                error={tv.catalogError}
                loadMore={tv.loadMore}
                restoreKey={tv.restoreKey}
                restoreScroll={tv.restoreScroll}
                render={(item) => <Poster item={item} open={tv.open} />}
            />
            {!tv.busy && !list.length ? (
                <Empty>
                    {t('No titles in this category. Try another category or search.')}
                </Empty>
            ) : null}
        </>
    );
}
