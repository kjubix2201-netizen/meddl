import { ChannelLogo, Clock, TvIcon } from '@meddl/tv/ui';
import { mediaTitle, t, tvLocale, type Media } from '@meddl/tv/util';
import type { useLiveOverlay } from './live-overlay';
import { AudioNotice } from './player-audio-notice';
import { useSoundFallback } from './sound-fallback';
import { VolumeControl } from './player-volume';
import type { TvModel } from './use-tv';

const clockTime = (value: number) =>
    new Date(value).toLocaleTimeString(tvLocale(), {
        hour: '2-digit',
        minute: '2-digit',
    });

function duration(seconds: number) {
    if (!Number.isFinite(seconds)) return '--:--';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Fullscreen player controls: back, channel logo and clock on top; title,
 * live badge, transport (previous / play-pause / next) and favorite, volume
 * at the bottom. Live: previous/next switch channels within the list the
 * channel was started from. Movies and episodes: they seek 10 seconds.
 */
export function PlayerOverlay({
    tv,
    overlay,
    visible,
    seriesDetails,
}: {
    tv: TvModel;
    overlay: ReturnType<typeof useLiveOverlay>;
    visible: boolean;
    seriesDetails: { busy: boolean; open: (item: Media) => Promise<void> };
}) {
    const current = tv.playing;
    const element = tv.player.current?.video ?? null;
    const sound = useSoundFallback(tv);
    // Position and length of the title, also while the sound is converted.
    const at = tv.player.current?.position ?? 0;
    const length = tv.player.current?.length ?? NaN;
    const live = current?.kind === 'live';
    const paused = element?.paused ?? true;
    const channels = live ? tv.catalog.items.filter((m) => m.kind === 'live') : [];
    const position = channels.findIndex((m) => m.id === current?.id);
    const zap = (step: number) => {
        const next = channels[position + step];
        if (!next) return;
        tv.setSelected(next);
        void tv.play(next);
    };
    const now = Date.now();
    const programme =
        live && tv.selected?.id === current?.id
            ? tv.epg.find((p) => p.start <= now && p.end > now)
            : undefined;
    const favorite = !!current && tv.data.favorites.some((m) => m.id === current.id);
    return (
        <div
            class={`player-controls ${visible || tv.error ? '' : 'dormant'}`}
            hidden={!!overlay.panel}
        >
            <div class="player-top">
                <div class="player-top-left">
                    <button
                        class="round"
                        data-focus="player-back"
                        aria-label={t('Back')}
                        onClick={tv.back}
                    >
                        <TvIcon name="back" />
                    </button>
                    {live ? <ChannelLogo src={current?.poster} /> : null}
                </div>
                {live ? (
                    <div class="actions player-live-actions">
                        <button data-focus="player-channels" onClick={overlay.openChannels}>
                            <TvIcon name="list" /> {t('Channels')}
                        </button>
                        <button data-focus="player-grid" onClick={overlay.openGrid}>
                            <TvIcon name="guide" /> {t('TV Guide')}
                        </button>
                        <button data-focus="player-guide" onClick={overlay.openGuide}>
                            {t('Programme')}
                        </button>
                    </div>
                ) : null}
                <Clock />
            </div>
            <div class="player-bottom">
                {live ? (
                    <span class="live-badge">{t('Live')}</span>
                ) : current?.season ? (
                    <span class="eyebrow">
                        {t('Season {season} · Episode {episode}', {
                            season: current.season,
                            episode: current.episode ?? '',
                        })}
                    </span>
                ) : null}
                <h1>{programme?.title ?? (current && mediaTitle(current))}</h1>
                <p class="player-subtitle">
                    {live
                        ? programme
                            ? `${current?.title} · ${clockTime(programme.start)} – ${clockTime(programme.end)}`
                            : current?.title
                        : current?.kind === 'episode'
                          ? current.title
                          : ''}
                </p>
                {!live ? (
                    <input
                        class="player-seek"
                        aria-label={t('Playback position')}
                        type="range"
                        min="0"
                        max={Number.isFinite(length) ? length : 0}
                        value={at}
                        onInput={(e) =>
                            tv.player.current?.seekTo(Number(e.currentTarget.value))
                        }
                    />
                ) : null}
                <div class="player-transport">
                    <span class="player-time">
                        {live
                            ? clockTime(now)
                            : `${duration(at)} / ${duration(length)}`}
                    </span>
                    <div class="transport-center">
                        <button
                            class="round"
                            aria-label={live ? t('Previous channel') : t('Back 10 seconds')}
                            disabled={live && position <= 0}
                            onClick={() => (live ? zap(-1) : tv.player.current?.seek(-10))}
                        >
                            <TvIcon name={live ? 'previous' : 'rewind'} />
                        </button>
                        <button
                            class="round primary play-toggle"
                            data-focus="player-toggle"
                            aria-label={paused ? t('Play') : t('Pause')}
                            onClick={() => tv.player.current?.toggle()}
                        >
                            <TvIcon name={paused ? 'play' : 'pause'} />
                        </button>
                        <button
                            class="round"
                            aria-label={live ? t('Next channel') : t('Forward 10 seconds')}
                            disabled={live && (position < 0 || position >= channels.length - 1)}
                            onClick={() => (live ? zap(1) : tv.player.current?.seek(10))}
                        >
                            <TvIcon name={live ? 'next' : 'forward'} />
                        </button>
                    </div>
                    <div class="transport-right">
                        {current?.kind === 'episode' ? (
                            <button
                                data-focus="player-series-details"
                                disabled={seriesDetails.busy}
                                onClick={() => void seriesDetails.open(current)}
                            >
                                {seriesDetails.busy ? t('Finding series…') : t('Series details')}
                            </button>
                        ) : null}
                        <button
                            class={`round ${favorite ? 'is-favorite' : ''}`}
                            aria-label={favorite ? t('Remove from favorites') : t('Add to favorites')}
                            aria-pressed={favorite}
                            onClick={() => current && tv.favorite(current)}
                        >
                            <TvIcon name="star" />
                        </button>
                        <VolumeControl video={element} />
                    </div>
                </div>
                <AudioNotice video={element} phase={sound.phase} onSilent={() => void sound.silent()} />
                {tv.player.current?.restoringPosition ? (
                    <p role="status">{t('Restoring saved position…')}</p>
                ) : null}
                {tv.error ? (
                    <div role="alert" class="error">
                        {tv.error}
                        {tv.errorRetry ? (
                            <button onClick={tv.errorRetry}>{tv.errorRetryLabel}</button>
                        ) : null}
                        <button onClick={() => tv.setError('')}>{t('Dismiss')}</button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
