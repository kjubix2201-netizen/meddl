import { Clock, TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import { ProfileFace } from './home-portrait';
import type { View } from './navigation';
import type { TvModel } from './use-tv';

/** Main sections as tabs; the rest as round icon buttons on the right. */
const SECTIONS: [View, string][] = [
    ['home', 'Home'],
    ['live', 'Live TV'],
    ['movies', 'Movies'],
    ['series', 'Series'],
];
// Settings and favourites open from the profile page (the avatar).
const TOOLS: [View, string, string][] = [['search', 'Search', 'search']];

/**
 * Home keeps the bar calm: wordmark, a search entry and the profile
 * button (sources, settings, favourites). The tiles below are the navigation.
 */
function HomeBar({ tv }: { tv: TvModel }) {
    return (
        <header class="top-bar home-bar" hidden={tv.fullscreen || !tv.storageReady}>
            <span class="home-wordmark">meddl</span>
            <span class="home-divider" aria-hidden="true" />
            <button
                class="search-pill"
                data-focus="nav:search"
                onClick={() => tv.navigate('search')}
            >
                <span>{t('Search')}</span>
            </button>
            <div class="top-tools">
                <button
                    class="round avatar"
                    data-focus="nav:sources"
                    aria-label={t('Sources & profile')}
                    title={t('Sources & profile')}
                    onClick={() => tv.navigate('sources')}
                >
                    <ProfileFace />
                </button>
            </div>
        </header>
    );
}

/**
 * Top navigation bar (replaces the former side rail). Buttons keep the
 * `nav:<view>` focus keys, so focus restoration after navigation and source
 * changes works as before.
 */
export function TopBar({ tv }: { tv: TvModel }) {
    const current = tv.route.view;
    if (current === 'home') return <HomeBar tv={tv} />;
    // Live TV channels (wide screens): only the tools, over the stage.
    const stage = current === 'live';
    return (
        <header class={`top-bar ${stage ? 'live-stage-bar' : ''}`} hidden={tv.fullscreen || !tv.storageReady}>
            <span class="home-wordmark">meddl</span>
            <span class="home-divider" aria-hidden="true" />
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
                <Clock />
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
                <button
                    class="round avatar"
                    data-focus="nav:sources"
                    aria-label={t('Sources & profile')}
                    title={t('Sources & profile')}
                    aria-current={current === 'sources' || current === 'settings' ? 'page' : undefined}
                    onClick={() => tv.navigate('sources')}
                >
                    <TvIcon name="user" />
                </button>
            </div>
        </header>
    );
}
