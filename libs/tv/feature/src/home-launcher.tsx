import { Clock, TvIcon } from '@meddl/tv/ui';
import { t, tvLocale, type Kind } from '@meddl/tv/util';
import { HomeWeather } from './home-weather';
import type { View } from './navigation';
import type { TvModel } from './use-tv';

type Tile = {
    view: View;
    kind: Kind;
    icon: string;
    title: string;
    /** Exact count (singular, plural) and rounded "+N" label. */
    unit: [string, string, string];
};

const TILES: Tile[] = [
    { view: 'live', kind: 'live', icon: 'tv-live', title: 'Live TV', unit: ['{count} channel', '{count} channels', '+{count} channels'] },
    { view: 'movies', kind: 'movie', icon: 'film', title: 'Movies', unit: ['{count} title', '{count} titles', '+{count} titles'] },
    { view: 'series', kind: 'series', icon: 'clapper', title: 'Series', unit: ['{count} series', '{count} series', '+{count} series'] },
];

/** "+5200 Sender" from 5234: rounded down to hundreds once there are 100+. */
function countLabel(count: number, unit: Tile['unit']) {
    if (count >= 100) {
        const rounded = Math.floor(count / 100) * 100;
        return t(unit[2], { count: rounded.toLocaleString(tvLocale()) });
    }
    return t(count === 1 ? unit[0] : unit[1], { count });
}

/**
 * Home screen launcher: three tall glass tiles (Live TV, Movies, Series),
 * weather, the wall clock and the date. Without a source the tiles lead to
 * the source setup instead.
 */
export function HomeLauncher({ tv }: { tv: TvModel }) {
    const counts = tv.homeCounts;
    const hasSource = tv.data.sources.length > 0;
    return (
        <section class="home-launcher" aria-label={t('Sections')}>
            <div class="launcher-row">
                <div class="launcher-tiles">
                    {TILES.map((tile) => {
                        const count = counts[tile.kind];
                        return (
                            <button
                                class={`launcher-tile launcher-${tile.kind}`}
                                data-focus={`launcher:${tile.view}`}
                                onClick={() =>
                                    tv.navigate(hasSource ? tile.view : 'sources')
                                }
                            >
                                <span class="launcher-icon" aria-hidden="true">
                                    <TvIcon name={tile.icon} />
                                </span>
                                <strong>{t(tile.title)}</strong>
                                <small>
                                    {!hasSource
                                        ? t('Add a source')
                                        : count !== undefined
                                          ? countLabel(count, tile.unit)
                                          : tv.busy
                                            ? t('Loading…')
                                            : ' '}
                                </small>
                                <span class="launcher-focus-bar" aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
                <div class="home-time">
                    <HomeWeather />
                    <Clock large />
                </div>
            </div>
            {/* More below (rows of the home page): a quiet arrow, gone once scrolled. */}
            <span
                class="home-more"
                aria-hidden="true"
                onClick={(event) => {
                    const next = (event.currentTarget.closest('.home-launcher') as HTMLElement | null)
                        ?.nextElementSibling as HTMLElement | null;
                    next?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
                    next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
            >
                <TvIcon name="down" />
            </span>
        </section>
    );
}
