import { useEffect, useRef, useState } from 'preact/hooks';
import {
    DesktopMpvSession,
    type DesktopMpvBounds,
    type DesktopMpvPlayback,
    type DesktopMpvState,
    type DesktopMpvTrack,
} from '@meddl/tv/data-access';
import { TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';

const HIDE_AFTER_MS = 4000;
const SEEK_SECONDS = 10;
const BACK_KEYS = ['Escape', 'BrowserBack', 'Backspace', 'GoBack'];
const PAUSE_KEYS = ['Enter', ' ', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'k'];

function clock(seconds: number | null | undefined) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

function trackName(track: DesktopMpvTrack) {
    const name = [track.title, track.language?.toUpperCase()].filter(Boolean).join(' · ');
    return name || t('Track {number}', { number: track.id });
}

/** The track after the selected one; subtitles end with "off" (-1). */
function nextTrack(tracks: DesktopMpvTrack[], selected: number | null | undefined, withOff: boolean) {
    const ids = [...tracks.map((track) => track.id), ...(withOff ? [-1] : [])];
    if (!ids.length) return null;
    const at = ids.indexOf(selected ?? -1);
    return ids[(at + 1) % ids.length];
}

/** The page area MPV may paint into: all of it, minus the bar while shown. */
function surface(bar: HTMLElement | null, controls: boolean): DesktopMpvBounds {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const reserved = controls && bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    return { x: 0, y: 0, width, height: Math.max(1, height - reserved) };
}

/**
 * Full-window player of the desktop app for sound the page cannot decode
 * (Dolby Digital, DTS …): the app's MPV player draws the picture, the page
 * keeps the keyboard and shows a control bar below the picture. Back closes
 * it and returns the position reached, like the Android TV native player.
 */
export function DesktopPlayer({
    playback,
    onClose,
    next,
    onEnded,
    onNext,
    onCancelNext,
    onZap,
}: {
    playback: DesktopMpvPlayback;
    onClose: (positionSeconds: number, durationSeconds: number) => void;
    /** The series' next episode and the autoplay countdown, if running. */
    next?: { title: string; countdown: number | null };
    onEnded?: (positionSeconds: number, durationSeconds: number) => void;
    onNext?: (positionSeconds: number, durationSeconds: number) => void;
    onCancelNext?: () => void;
    /** Live: switches to the channel before (-1) or after (1) in the list. */
    onZap?: (direction: number) => boolean;
}) {
    const [state, setState] = useState<DesktopMpvState | null>(null);
    const [failure, setFailure] = useState('');
    const [controls, setControls] = useState(true);
    // Where the viewer drags the seek bar to (applied on release).
    const [scrub, setScrub] = useState<number | null>(null);
    const muted = useRef(1);
    const bar = useRef<HTMLDivElement>(null);
    const session = useRef<DesktopMpvSession | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();
    const closed = useRef(false);
    const lastSeek = useRef(0);
    const latestClose = useRef(onClose);
    latestClose.current = onClose;
    const latestNext = useRef({ next, onEnded, onNext, onZap });
    latestNext.current = { next, onEnded, onNext, onZap };
    const countdown = next?.countdown != null;

    const close = () => {
        if (closed.current) return;
        closed.current = true;
        const current = session.current?.state;
        void session.current?.stop();
        latestClose.current(current?.positionSeconds ?? 0, current?.durationSeconds ?? 0);
    };
    const reveal = () => {
        setControls(true);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setControls(false), HIDE_AFTER_MS);
    };

    useEffect(() => {
        const mpv = new DesktopMpvSession((update) => {
            setState({ ...update });
            if (update.status === 'ended') {
                const { next: episode, onEnded: ended } = latestNext.current;
                if (episode && ended) {
                    ended(update.positionSeconds, update.durationSeconds ?? update.positionSeconds);
                    setControls(true);
                } else close();
            }
            if (update.status === 'error') setFailure(update.error || t('This stream could not be played.'));
        });
        session.current = mpv;
        mpv.start(surface(bar.current, true), playback).catch((error: unknown) =>
            setFailure(error instanceof Error ? error.message : String(error))
        );
        reveal();
        return () => {
            clearTimeout(hideTimer.current);
            void mpv.stop();
        };
    }, []);

    useEffect(() => {
        const sync = () => session.current?.setBounds(surface(bar.current, controls || !!failure || countdown));
        sync();
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, [controls, failure, countdown]);

    useEffect(() => {
        const keys = (event: KeyboardEvent) => {
            // The seek and volume sliders keep their own arrow keys only for the mouse.
            event.preventDefault();
            event.stopImmediatePropagation();
            const mpv = session.current;
            if (event.keyCode === 461 || BACK_KEYS.includes(event.key)) return close();
            reveal();
            if (!mpv) return;
            const upcoming = latestNext.current;
            if (event.key === 'Enter' && upcoming.next?.countdown != null && upcoming.onNext) {
                const at = mpv.state;
                return upcoming.onNext(at?.positionSeconds ?? 0, at?.durationSeconds ?? at?.positionSeconds ?? 0);
            }
            if (PAUSE_KEYS.includes(event.key) || [415, 19, 179].includes(event.keyCode)) mpv.togglePause();
            else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !playback.isLive) {
                // Held down: an even pace (one 10 s step every 120 ms), not
                // the keyboard's repeat rate.
                const now = Date.now();
                if (event.repeat && now - lastSeek.current < 120) return;
                lastSeek.current = now;
                mpv.seekBy(event.key === 'ArrowRight' ? SEEK_SECONDS : -SEEK_SECONDS);
            }
            // Live: Up / Down (and Page / Channel keys) switch channels, like a TV.
            else if (playback.isLive && upcoming.onZap && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'ChannelUp', 'ChannelDown'].includes(event.key))
                upcoming.onZap(['ArrowDown', 'PageDown', 'ChannelDown'].includes(event.key) ? 1 : -1);
            else if (['ArrowUp', 'AudioVolumeUp', '+'].includes(event.key)) mpv.changeVolume(0.1);
            else if (['ArrowDown', 'AudioVolumeDown', '-'].includes(event.key)) mpv.changeVolume(-0.1);
            else if (event.key === 'm' || event.key === 'AudioVolumeMute') toggleMute();
            else if (event.key === 'a') cycleAudio();
            else if (event.key === 's' || event.key === 'c') cycleSubtitles();
            else if (event.key === 'j' && !playback.isLive) mpv.seekBy(-60);
            else if (event.key === 'l' && !playback.isLive) mpv.seekBy(60);
        };
        window.addEventListener('keydown', keys, true);
        return () => window.removeEventListener('keydown', keys, true);
    }, []);

    function toggleMute() {
        const mpv = session.current;
        if (!mpv?.state) return;
        if (mpv.state.volume > 0) {
            muted.current = mpv.state.volume;
            mpv.setVolume(0);
        } else mpv.setVolume(muted.current || 1);
    }
    function cycleAudio() {
        const mpv = session.current;
        const next = nextTrack(mpv?.state?.audioTracks ?? [], mpv?.state?.selectedAudioTrackId, false);
        if (mpv && next !== null) mpv.setAudioTrack(next);
    }
    function cycleSubtitles() {
        const mpv = session.current;
        const tracks = mpv?.state?.subtitleTracks ?? [];
        const next = nextTrack(tracks, mpv?.state?.selectedSubtitleTrackId, true);
        if (mpv && tracks.length && next !== null) mpv.setSubtitleTrack(next);
    }

    const status = state?.status ?? 'loading';
    const duration = state?.durationSeconds ?? null;
    const position = state?.positionSeconds ?? 0;
    const shownAt = scrub ?? position;
    const volume = state?.volume ?? 1;
    const audioTracks = state?.audioTracks ?? [];
    const subtitleTracks = state?.subtitleTracks ?? [];
    const audio = audioTracks.find((track) => track.id === state?.selectedAudioTrackId);
    const subtitle = subtitleTracks.find((track) => track.id === state?.selectedSubtitleTrackId);
    const seekable = !playback.isLive && !!duration && duration > 0;
    const shown = controls || !!failure || next?.countdown != null;
    return (
        <div class={`desktop-player ${shown ? '' : 'dormant'}`} data-tv-modal onMouseMove={reveal}>
            {status === 'loading' && !failure ? (
                <span class="spinner large desktop-player-spinner" aria-hidden="true" />
            ) : null}
            <div class="desktop-player-bar" ref={bar}>
                <div class="desktop-player-row">
                    <button class="round" aria-label={t('Back')} onClick={close}>
                        <TvIcon name="back" />
                    </button>
                    {playback.isLive ? null : (
                        <button class="round" aria-label={t('Back 10 seconds')} onClick={() => session.current?.seekBy(-SEEK_SECONDS)}>
                            <TvIcon name="rewind" />
                        </button>
                    )}
                    <button
                        class="round"
                        aria-label={status === 'paused' ? t('Play') : t('Pause')}
                        onClick={() => session.current?.togglePause()}
                    >
                        <TvIcon name={status === 'paused' ? 'play' : 'pause'} />
                    </button>
                    {playback.isLive ? null : (
                        <button class="round" aria-label={t('Forward 10 seconds')} onClick={() => session.current?.seekBy(SEEK_SECONDS)}>
                            <TvIcon name="forward" />
                        </button>
                    )}
                    <div class="desktop-player-title">
                        <strong>{playback.title}</strong>
                        <small>
                            {failure
                                ? failure
                                : status === 'loading'
                                  ? t('Loading…')
                                  : status === 'paused'
                                    ? t('Paused')
                                    : t('Dolby / DTS sound through the meddl player')}
                        </small>
                    </div>
                    {next && onNext ? (
                        <button
                            class="desktop-player-pill"
                            onClick={() => onNext(position, duration ?? position)}
                            title={next.title}
                        >
                            {t('Next episode')}
                        </button>
                    ) : null}
                    {audioTracks.length > 1 ? (
                        <button class="desktop-player-pill" onClick={cycleAudio} title={t('Change audio track (A)')}>
                            {t('Audio')}: {audio ? trackName(audio) : '–'}
                        </button>
                    ) : null}
                    {subtitleTracks.length ? (
                        <button class="desktop-player-pill" onClick={cycleSubtitles} title={t('Change subtitles (S)')}>
                            {t('Subtitles')}: {subtitle ? trackName(subtitle) : t('Off')}
                        </button>
                    ) : null}
                    <button class="round" aria-label={volume > 0 ? t('Mute') : t('Unmute')} onClick={toggleMute}>
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
                        onInput={(event) => session.current?.setVolume(Number(event.currentTarget.value) / 100)}
                    />
                    {playback.isLive ? (
                        <span class="live-badge">{t('Live')}</span>
                    ) : (
                        <span class="desktop-player-time">
                            {clock(shownAt)} / {clock(duration)}
                        </span>
                    )}
                </div>
                {seekable ? (
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
                            reveal();
                            setScrub(Number(event.currentTarget.value));
                        }}
                        onChange={(event) => {
                            session.current?.seekTo(Number(event.currentTarget.value));
                            setScrub(null);
                        }}
                    />
                ) : null}
                {next && next.countdown !== null ? (
                    <div class="next-banner desktop-next" role="status">
                        <span>{t('Next episode in {seconds} s: {title}', { seconds: next.countdown, title: next.title })}</span>
                        <button class="primary" onClick={() => onNext?.(position, duration ?? position)}>
                            {t('Play now')}
                        </button>
                        <button onClick={onCancelNext}>{t('Cancel')}</button>
                    </div>
                ) : null}
                <p class="desktop-player-keys muted">
                    {playback.isLive
                        ? t('Space: pause · ↑↓: channel · +/−: volume · A: audio · S: subtitles · Esc: back')
                        : t('Space: pause · ←→: 10 s · J/L: 1 min · ↑↓: volume · A: audio · S: subtitles · Esc: back')}
                </p>
            </div>
        </div>
    );
}
