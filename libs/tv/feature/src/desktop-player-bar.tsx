import { useState } from 'preact/hooks';
import type { DesktopMpvTrack } from '@meddl/tv/data-access';
import { TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';

export const SEEK_SECONDS = 10;

export function clock(seconds: number | null | undefined) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

export function trackName(track: DesktopMpvTrack) {
    const name = [track.title, track.language?.toUpperCase()].filter(Boolean).join(' · ');
    return name || t('Track {number}', { number: track.id });
}

/** What the meddl player's bar shows; also sent to the see-through overlay window. */
export interface PlayerBarState {
    title: string;
    isLive: boolean;
    status: string;
    failure: string;
    position: number;
    duration: number | null;
    volume: number;
    audioTracks: DesktopMpvTrack[];
    audioId: number | null;
    subtitleTracks: DesktopMpvTrack[];
    subtitleId: number | null;
    next?: { title: string; countdown: number | null };
    /** False while the controls are hidden (no mouse or key for a while). */
    shown: boolean;
}

export type PlayerBarCommand =
    | { type: 'back' | 'toggle' | 'mute' | 'audio' | 'subtitles' | 'next' | 'cancelNext' | 'activity' }
    | { type: 'seekBy' | 'seekTo'; seconds: number }
    | { type: 'volume'; value: number };

/**
 * The meddl player's controls, laid out like a TV player: title, timeline,
 * then the buttons with Play in the middle. Used below the picture in the
 * page and, see-through over the picture, in the overlay window.
 */
export function PlayerBar({
    state,
    send,
    barRef,
}: {
    state: PlayerBarState;
    send: (command: PlayerBarCommand) => void;
    barRef?: { current: HTMLDivElement | null };
}) {
    // Where the viewer drags the timeline to (applied on release).
    const [scrub, setScrub] = useState<number | null>(null);
    const duration = state.duration;
    const shownAt = scrub ?? state.position;
    const volume = state.volume;
    const audioTracks = state.audioTracks;
    const subtitleTracks = state.subtitleTracks;
    const audio = audioTracks.find((track) => track.id === state.audioId);
    const subtitle = subtitleTracks.find((track) => track.id === state.subtitleId);
    const seekable = !state.isLive && !!duration && duration > 0;
    return (
        <div class="desktop-player-bar" ref={barRef}>
            <div class="dp-head">
                <div class="dp-title">
                    <strong>{state.title}</strong>
                    {state.failure || state.status === 'loading' || state.status === 'paused' ? (
                        <small class={state.failure ? 'dp-failure' : ''}>
                            {state.failure ? state.failure : state.status === 'loading' ? t('Loading…') : t('Paused')}
                        </small>
                    ) : null}
                </div>
                {state.isLive ? <span class="live-badge">{t('Live')}</span> : null}
            </div>
            {seekable ? (
                <div class="dp-timeline">
                    <span class="dp-time">{clock(shownAt)}</span>
                    <input
                        class="desktop-player-seek"
                        type="range"
                        min={0}
                        max={Math.floor(duration!)}
                        step={1}
                        value={Math.floor(shownAt)}
                        aria-label={t('Position')}
                        style={{ '--share': `${Math.min(100, (shownAt / duration!) * 100)}%` }}
                        onInput={(event) => {
                            send({ type: 'activity' });
                            setScrub(Number(event.currentTarget.value));
                        }}
                        onChange={(event) => {
                            send({ type: 'seekTo', seconds: Number(event.currentTarget.value) });
                            setScrub(null);
                        }}
                    />
                    <span class="dp-time">−{clock(Math.max(0, duration! - shownAt))}</span>
                </div>
            ) : null}
            <div class="dp-controls">
                <div class="dp-side">
                    <button class="dp-icon" aria-label={t('Back')} title={t('Back') + ' (Esc)'} onClick={() => send({ type: 'back' })}>
                        <TvIcon name="back" />
                    </button>
                </div>
                <div class="dp-center">
                    {state.isLive ? null : (
                        <button
                            class="dp-icon"
                            aria-label={t('Back 10 seconds')}
                            title={t('Back 10 seconds') + ' (←)'}
                            onClick={() => send({ type: 'seekBy', seconds: -SEEK_SECONDS })}
                        >
                            <TvIcon name="rewind" />
                        </button>
                    )}
                    <button
                        class={`dp-play${state.status === 'loading' && !state.failure ? ' is-loading' : ''}`}
                        aria-label={state.status === 'paused' ? t('Play') : t('Pause')}
                        title={(state.status === 'paused' ? t('Play') : t('Pause')) + ' (Space)'}
                        onClick={() => send({ type: 'toggle' })}
                    >
                        <TvIcon name={state.status === 'paused' ? 'play' : 'pause'} />
                    </button>
                    {state.isLive ? null : (
                        <button
                            class="dp-icon"
                            aria-label={t('Forward 10 seconds')}
                            title={t('Forward 10 seconds') + ' (→)'}
                            onClick={() => send({ type: 'seekBy', seconds: SEEK_SECONDS })}
                        >
                            <TvIcon name="forward" />
                        </button>
                    )}
                </div>
                <div class="dp-side dp-right">
                    {state.next ? (
                        <button class="dp-pill" onClick={() => send({ type: 'next' })} title={state.next.title}>
                            {t('Next episode')} <TvIcon name="next" />
                        </button>
                    ) : null}
                    {audioTracks.length > 1 ? (
                        <button class="dp-pill" onClick={() => send({ type: 'audio' })} title={t('Change audio track (A)')}>
                            {t('Audio')}: {audio ? trackName(audio) : '–'}
                        </button>
                    ) : null}
                    {subtitleTracks.length ? (
                        <button class="dp-pill" onClick={() => send({ type: 'subtitles' })} title={t('Change subtitles (S)')}>
                            {t('Subtitles')}: {subtitle ? trackName(subtitle) : t('Off')}
                        </button>
                    ) : null}
                    <button
                        class="dp-icon"
                        aria-label={volume > 0 ? t('Mute') : t('Unmute')}
                        title={(volume > 0 ? t('Mute') : t('Unmute')) + ' (M)'}
                        onClick={() => send({ type: 'mute' })}
                    >
                        <TvIcon name={volume > 0 ? 'volume' : 'muted'} />
                    </button>
                    <input
                        class="desktop-player-volume"
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(volume * 100)}
                        aria-label={t('Volume')}
                        style={{ '--share': `${Math.round(volume * 100)}%` }}
                        onInput={(event) => send({ type: 'volume', value: Number(event.currentTarget.value) / 100 })}
                    />
                </div>
            </div>
            {state.next && state.next.countdown !== null ? (
                <div class="next-banner desktop-next" role="status">
                    <span>{t('Next episode in {seconds} s: {title}', { seconds: state.next.countdown, title: state.next.title })}</span>
                    <button class="primary" onClick={() => send({ type: 'next' })}>
                        {t('Play now')}
                    </button>
                    <button onClick={() => send({ type: 'cancelNext' })}>{t('Cancel')}</button>
                </div>
            ) : null}
            {state.status === 'paused' ? (
                <p class="desktop-player-keys muted">
                    {state.isLive
                        ? t('Space: pause · ↑↓: channel · +/−: volume · A: audio · S: subtitles · Esc: back')
                        : t('Space: pause · ←→: 10 s · J/L: 1 min · ↑↓: volume · A: audio · S: subtitles · Esc: back')}
                </p>
            ) : null}
        </div>
    );
}
