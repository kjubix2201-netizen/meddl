import { Clock, TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import type { View } from './navigation';
import type { TvModel } from './use-tv';

/** Main sections as tabs; the rest as round icon buttons on the right. */
const SECTIONS: [View, string][] = [
    ['home', 'Home'],
    ['live', 'Live TV'],
    ['movies', 'Movies'],
    ['series', 'Series'],
];
const TOOLS: [View, string, string][] = [
    ['search', 'Search', 'search'],
    ['favorites', 'Favorites', 'star'],
    ['sources', 'Sources', 'sources'],
    ['settings', 'Settings', 'settings'],
];

/**
 * Top navigation bar (replaces the former side rail). Buttons keep the
 * `nav:<view>` focus keys, so focus restoration after navigation and source
 * changes works as before.
 */
export function TopBar({ tv }: { tv: TvModel }) {
    const current = tv.route.view;
    return (
        <header class="top-bar" hidden={tv.fullscreen || !tv.storageReady}>
            <div class="wordmark">
                <img class="wordmark-logo" src="icon.png" alt="" />
                <span class="wordmark-text">
                    meddl<small>TV</small>
                </span>
            </div>
            <nav class="top-tabs" aria-label={t('Main navigation')}>
                {SECTIONS.map(([view, label]) => (
                    <button
                        data-focus={`nav:${view}`}
                        aria-current={current === view ? 'page' : undefined}
                        onClick={() => tv.navigate(view)}
                    >
                        {t(label)}
                    </button>
                ))}
            </nav>
            <div class="top-tools">
                {TOOLS.map(([view, label, icon]) => (
                    <button
                        class="round"
                        data-focus={`nav:${view}`}
                        aria-label={t(label)}
                        title={t(label)}
                        aria-current={current === view ? 'page' : undefined}
                        onClick={() => tv.navigate(view)}
                    >
                        <TvIcon name={icon} />
                    </button>
                ))}
                <Clock />
            </div>
        </header>
    );
}
