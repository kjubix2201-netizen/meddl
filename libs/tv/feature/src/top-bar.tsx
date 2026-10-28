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
const TOOLS: [View, string, string][] = [
    ['search', 'Search', 'search'],
    ['favorites', 'Favorites', 'star'],
];

/**
 * Home keeps the bar calm: wordmark, a search entry, settings and the
 * profile button (sources). The tiles below are the navigation.
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
                    class="round"
                    data-focus="nav:settings"
                    aria-label={t('Settings')}
                    title={t('Settings')}
                    onClick={() => tv.navigate('settings')}
                >
                    <TvIcon name="gear" />
                </button>
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
    return (
        <header class="top-bar" hidden={tv.fullscreen || !tv.storageReady}>
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
                <button
                    class="round"
                    data-focus="nav:settings"
                    aria-label={t('Settings')}
                    title={t('Settings')}
                    aria-current={current === 'settings' ? 'page' : undefined}
                    onClick={() => tv.navigate('settings')}
                >
                    <TvIcon name="gear" />
                </button>
                <button
                    class="round avatar"
                    data-focus="nav:sources"
                    aria-label={t('Sources & profile')}
                    title={t('Sources & profile')}
                    aria-current={current === 'sources' ? 'page' : undefined}
                    onClick={() => tv.navigate('sources')}
                >
                    <TvIcon name="user" />
                </button>
            </div>
        </header>
    );
}
