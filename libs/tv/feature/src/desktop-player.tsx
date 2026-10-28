import { useEffect, useRef, useState } from 'preact/hooks';
import { DesktopMpvSession, type DesktopMpvBounds, type DesktopMpvPlayback, type DesktopMpvState } from '@meddl/tv/data-access';
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
}: {
    playback: DesktopMpvPlayback;
    onClose: (positionSeconds: number, durationSeconds: number) => void;
}) {
    const [state, setState] = useState<DesktopMpvState | null>(null);
    const [failure, setFailure] = useState('');
    const [controls, setControls] = useState(true);
    const bar = useRef<HTMLDivElement>(null);
    const session = useRef<DesktopMpvSession | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();
    const closed = useRef(false);
    const latestClose = useRef(onClose);
    latestClose.current = onClose;

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
        const mpv = new DesktopMpvSession((next) => {
            setState({ ...next });
            if (next.status === 'ended') close();
            if (next.status === 'error') setFailure(next.error || t('This stream could not be played.'));
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
        const sync = () => session.current?.setBounds(surface(bar.current, controls || !!failure));
        sync();
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, [controls, failure]);

    useEffect(() => {
        const keys = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            const mpv = session.current;
            if (event.keyCode === 461 || BACK_KEYS.includes(event.key)) return close();
            reveal();
            if (!mpv) return;
            if (PAUSE_KEYS.includes(event.key) || [415, 19, 179].includes(event.keyCode)) mpv.togglePause();
            else if (event.key === 'ArrowLeft' && !playback.isLive) mpv.seekBy(-SEEK_SECONDS);
            else if (event.key === 'ArrowRight' && !playback.isLive) mpv.seekBy(SEEK_SECONDS);
            else if (event.key === 'ArrowUp' || event.key === 'AudioVolumeUp') mpv.changeVolume(0.1);
            else if (event.key === 'ArrowDown' || event.key === 'AudioVolumeDown') mpv.changeVolume(-0.1);
        };
        window.addEventListener('keydown', keys, true);
        return () => window.removeEventListener('keydown', keys, true);
    }, []);

    const status = state?.status ?? 'loading';
    const duration = state?.durationSeconds ?? null;
    const position = state?.positionSeconds ?? 0;
    const share = duration && duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
    const shown = controls || !!failure;
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
                    <button
                        class="round"
                        aria-label={status === 'paused' ? t('Play') : t('Pause')}
                        onClick={() => session.current?.togglePause()}
                    >
                        <TvIcon name={status === 'paused' ? 'play' : 'pause'} />
                    </button>
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
                    {playback.isLive ? (
                        <span class="live-badge">{t('Live')}</span>
                    ) : (
                        <span class="desktop-player-time">
                            {clock(position)} / {clock(duration)}
                        </span>
                    )}
                </div>
                {playback.isLive ? null : (
                    <div class="now-progress" aria-hidden="true">
                        <span style={{ width: `${share}%` }} />
                    </div>
                )}
                <p class="desktop-player-keys muted">
                    {playback.isLive
                        ? t('Space: pause · ↑↓: volume · Esc: back')
                        : t('Space: pause · ←→: 10 s · ↑↓: volume · Esc: back')}
                </p>
            </div>
        </div>
    );
}
