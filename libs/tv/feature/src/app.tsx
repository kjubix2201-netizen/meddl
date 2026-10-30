import { LiveOverlay, useLiveOverlay } from './live-overlay';
import { useLiveBrowse } from './use-live-browse';
import { useHomeFeature } from './use-home-feature';
import { PageHeader } from './page-header';
import { Favorites } from './favorites';
import { usePlayerControls } from './player-controls';
import { PlayerOverlay } from './player-overlay';
import { useSoundFallback } from './sound-fallback';
import { DesktopPlayer } from './desktop-player';
import { useNextEpisode } from './next-episode';
import { TopBar } from './top-bar';
import { useEffect, useRef } from 'preact/hooks';
import { useTv } from './use-tv';
import { Sources } from './forms';
import { Settings } from './settings';
import type { SettingsMemory } from './settings-navigation';
import { Home, CatalogScreen } from './screens';
import { CountryPicker } from './country-picker';
import { CatalogStage } from './catalog-stage';
import { LoadingOverlay } from './loading-overlay';
import { needsCountry } from './country-catalog';
import { Detail } from './detail';
import { useDetailSeason } from './use-detail-season';
import { Live } from './live';
import { Backdrop } from '@meddl/tv/ui';
import { useMetadata } from './use-metadata';
import { useSeriesContext } from './use-series-context';
import { useSeriesDetails } from './use-series-details';
import { t } from '@meddl/tv/util';
import { PersonPage } from './person-page';
import type { FilmographyMemory } from './use-filmography-search';
export function TvApp() {
    const personMemory = useRef<FilmographyMemory>(new WeakMap());
    const settingsMemory = useRef<SettingsMemory>({
        category: 'connection',
        controls: {},
        scroll: {},
    });
    const video = useRef<HTMLVideoElement>(null);
    const tv = useTv(video);
    const detailSeason = useDetailSeason(tv.route);
    const seriesDetails = useSeriesDetails(tv);
    useSeriesContext(tv);
    const browse = useLiveBrowse(tv);
    const overlay = useLiveOverlay(tv, browse);
    // Mounted for the live preview too: a channel the page cannot play
    // opens in the app's own player instead of an error.
    const sound = useSoundFallback(tv);
    const nextEpisode = useNextEpisode(tv, video.current);
    sound.nextEpisode.current = nextEpisode.next
        ? { title: nextEpisode.next.title, play: nextEpisode.playNext }
        : undefined;
    useEffect(() => {
        const position = () => {
            const rect = document
                .querySelector('.preview-placeholder')
                ?.getBoundingClientRect();
            const frame = document.querySelector<HTMLElement>(
                '.native-player.preview'
            );
            if (rect && frame)
                Object.assign(frame.style, {
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                });
        };
        position();
        window.addEventListener('resize', position);
        document.addEventListener('scroll', position, true);
        return () => {
            window.removeEventListener('resize', position);
            document.removeEventListener('scroll', position, true);
        };
    });
    const r = tv.route;
    const feature = useHomeFeature(tv);
    const cinematic = r.view === 'home' || r.view === 'detail';
    const metadata = useMetadata(
        r.view === 'detail'
            ? tv.selected
            : r.view === 'home'
              ? feature.item
              : undefined,
        tv.data.tmdb
    );
    const display = {
        ...tv,
        selected: r.view === 'detail' ? metadata.item : tv.selected,
        home:
            r.view === 'home' && metadata.item
                ? tv.home.map((item) =>
                      item.id === metadata.item?.id ? metadata.item : item
                  )
                : tv.home,
    };
    const current = tv.playing;
    const element = video.current;
    const controlsVisible = usePlayerControls(
        tv.fullscreen,
        !!overlay.panel || (element?.paused ?? true)
    );
    return (
        <div
            class={`tv-app ${tv.data.layout}`}
            onMouseMove={(event) => {
                if (!event.movementX && !event.movementY) return;
                const button = (event.target as HTMLElement).closest('button');
                if (button && button !== document.activeElement)
                    button.focus({ preventScroll: true });
            }}
        >
            {!tv.storageReady ? (
                <section
                    class="source-form storage-recovery"
                    aria-label={t('Saved TV data')}
                >
                    <h1>meddl TV</h1>
                    {tv.storageError ? (
                        <>
                            <p role="alert">{tv.storageError}</p>
                            <button
                                autoFocus
                                onClick={() => void tv.retryStorage()}
                            >
                                {t('Retry reading saved data')}
                            </button>
                        </>
                    ) : (
                        <p role="status">{t('Loading saved TV data…')}</p>
                    )}
                </section>
            ) : null}
            <TopBar tv={tv} />
            <main
                hidden={tv.fullscreen || !tv.storageReady}
                class={
                    r.view === 'movies' || r.view === 'series'
                        ? 'catalog-stage-page'
                        : needsCountry(r) && r.view !== 'live'
                        ? 'country-page'
                        : cinematic
                          ? `cinematic-page ${r.view}-page`
                        : r.view === 'settings'
                          ? 'settings-page'
                          : r.view === 'live'
                            ? 'live-page'
                            : r.view === 'sources'
                              ? 'sources-page'
                              : ''
                }
            >
                {cinematic ? <Backdrop item={metadata.item} /> : null}
                <PageHeader tv={tv} />
                {/* Notices float above every screen instead of pushing it down. */}
                <div class="app-toasts">
                    {metadata.failed ? (
                        <div class="metadata-notice" role="status">
                            {t('TMDB is unavailable. Showing provider information.')}
                            <button onClick={metadata.retry}>{t('Retry metadata')}</button>
                        </div>
                    ) : null}
                    {tv.error ? (
                        <div role="alert" class="error">
                            <span>{t(tv.error)}</span>
                            {tv.errorRetry ? (
                                <button onClick={tv.errorRetry}>
                                    {tv.errorRetryLabel}
                                </button>
                            ) : null}
                            <button onClick={() => tv.setError('')}>{t('Dismiss')}</button>
                            <button onClick={() => tv.navigate('sources')}>
                                {t('Edit sources')}
                            </button>
                        </div>
                    ) : null}
                    {tv.reconnectStatus ? (
                        <p role="status">{tv.reconnectStatus}</p>
                    ) : null}
                    {tv.busy ? (
                        <div class="loading" role="status">
                            {t('Connecting to your source…')}
                        </div>
                    ) : null}
                </div>
                {/* Live TV, Movies and Series choose the country in a drawer on their own page. */}
                {r.view === 'movies' || r.view === 'series' ? (
                    <CatalogStage tv={tv} />
                ) : needsCountry(r) && r.view !== 'live' ? (
                    <CountryPicker tv={tv} />
                ) : r.view === 'home' ? (
                    <Home tv={display} history={feature.history} />
                ) : r.view === 'sources' ? (
                    <Sources tv={tv} />
                ) : r.view === 'settings' ? (
                    <Settings tv={tv} memory={settingsMemory.current} />
                ) : r.view === 'live' ? (
                    <Live
                        key={tv.data.activeId}
                        tv={tv}
                        browse={browse}
                        overlayOpen={overlay.panel === 'channels'}
                        openGuide={overlay.openGuide}
                        openGrid={overlay.openGrid}
                    />
                ) : r.view === 'favorites' ? (
                    <Favorites tv={tv} />
                ) : r.view === 'person' ? (
                    <PersonPage
                        key={`${tv.data.activeId}:${r.person?.tmdbId}`}
                        tv={tv}
                        client={metadata.client}
                        memory={personMemory.current}
                    />
                ) : r.view === 'detail' ? (
                    <Detail
                        key={r.item?.id}
                        tv={display}
                        metadataClient={metadata.client}
                        season={detailSeason.season}
                        selectSeason={detailSeason.select}
                    />
                ) : (
                    <CatalogScreen tv={tv} />
                )}
            </main>
            <div
                class={`native-player ${tv.fullscreen ? 'fullscreen' : 'preview'}`}
                hidden={!current}
            >
                {/* Transparent poster: Android's WebView otherwise shows a grey play symbol while loading. */}
                <video
                    ref={video}
                    playsInline
                    preload="metadata"
                    poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
                />
                {tv.fullscreen ? (
                    <PlayerOverlay
                        tv={tv}
                        overlay={overlay}
                        visible={controlsVisible}
                        seriesDetails={seriesDetails}
                        sound={sound}
                        nextEpisode={nextEpisode}
                    />
                ) : null}
            </div>
            {sound.desktop ? (
                <DesktopPlayer
                    key={current?.id}
                    playback={sound.desktop}
                    onClose={sound.desktopClosed}
                    next={nextEpisode.next ? { title: nextEpisode.next.title, countdown: nextEpisode.countdown } : undefined}
                    onEnded={(position, duration) => {
                        sound.desktopContinue(position, duration);
                        nextEpisode.begin();
                    }}
                    onNext={(position, duration) => {
                        sound.desktopContinue(position, duration);
                        nextEpisode.playNext();
                    }}
                    onCancelNext={nextEpisode.cancel}
                    onZap={sound.zap}
                />
            ) : null}
            <LiveOverlay tv={tv} browse={browse} overlay={overlay} />
            <LoadingOverlay tv={tv} />
        </div>
    );
}
