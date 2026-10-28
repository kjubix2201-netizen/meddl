import { Clock, TvIcon } from '@meddl/tv/ui';
import { t, tvLocale, type Kind } from '@meddl/tv/util';
import type { View } from './navigation';
import type { TvModel } from './use-tv';

const TILES: { view: View; kind: Kind; icon: string; title: string; unit: [string, string] }[] = [
    { view: 'live', kind: 'live', icon: 'live', title: 'Live TV', unit: ['{count} channel', '{count} channels'] },
    { view: 'movies', kind: 'movie', icon: 'movies', title: 'Movies', unit: ['{count} movie', '{count} movies'] },
    { view: 'series', kind: 'series', icon: 'series', title: 'Series', unit: ['{count} series', '{count} series'] },
];

/**
 * Home screen launcher: one large glass tile per section with its title
 * count, and the wall clock. Down from the top bar lands on the tiles.
 */
export function HomeLauncher({ tv }: { tv: TvModel }) {
    const counts = tv.homeCounts;
    return (
        <section class="home-launcher" aria-label={t('Sections')}>
            <div class="launcher-tiles">
                {TILES.map((tile) => {
                    const count = counts[tile.kind];
                    return (
                        <button
                            class={`launcher-tile launcher-${tile.kind}`}
                            data-focus={`launcher:${tile.view}`}
                            onClick={() => tv.navigate(tile.view)}
                        >
                            <span class="launcher-icon" aria-hidden="true">
                                <TvIcon name={tile.icon} />
                            </span>
                            <strong>{t(tile.title)}</strong>
                            <small>
                                {count === undefined
                                    ? tv.busy
                                        ? t('Loading…')
                                        : ' '
                                    : t(count === 1 ? tile.unit[0] : tile.unit[1], {
                                          count: count.toLocaleString(tvLocale()),
                                      })}
                            </small>
                            <span class="launcher-focus-bar" aria-hidden="true" />
                        </button>
                    );
                })}
            </div>
            <Clock large />
        </section>
    );
}
