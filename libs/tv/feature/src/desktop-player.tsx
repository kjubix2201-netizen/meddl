import { useEffect, useRef, useState } from 'preact/hooks';
import {
    DesktopMpvSession,
    type DesktopMpvBounds,
    type DesktopMpvPlayback,
    type DesktopMpvState,
    type DesktopMpvTrack,
} from '@meddl/tv/data-access';
import { t } from '@meddl/tv/util';
import { PlayerBar, SEEK_SECONDS, type PlayerBarCommand, type PlayerBarState } from './desktop-player-bar';

const HIDE_AFTER_MS = 4000;
const BACK_KEYS = ['Escape', 'BrowserBack', 'Backspace', 'GoBack'];
const PAUSE_KEYS = ['Enter', ' ', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'k'];

type OverlayBridge = {
    open: () => Promise<boolean>;
    close: () => Promise<void>;
    update: (state: PlayerBarState) => void;
    onCommand: (callback: (command: unknown) => void) => () => void;
};

/** The desktop app's see-through controls window over the video, if it has one. */
function overlayBridge(): OverlayBridge | undefined {
    const overlay = (window as unknown as { meddlDesktop?: { overlay?: OverlayBridge } }).meddlDesktop?.overlay;
    return overlay && typeof overlay.open === 'function' ? overlay : undefined;
}

/** The track after the selected one; subtitles end with "off" (-1). */
function nextTrack(tracks: DesktopMpvTrack[], selected: number | null | undefined, withOff: boolean) {
    const ids = [...tracks.map((track) => track.id), ...(withOff ? [-1] : [])];
    if (!ids.length) return null;
    const at = ids.indexOf(selected ?? -1);
    return ids[(at + 1) % ids.length];
}

/** The page area MPV may paint into: all of it, minus the bar while shown below it. */
function surface(bar: HTMLElement | null, controls: boolean): DesktopMpvBounds {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const reserved = controls && bar ? Math.ceil(bar.getBoundingClientRect().height) : 0;
    return { x: 0, y: 0, width, height: Math.max(1, height - reserved) };
}

/**
 * Full-window player of the desktop app (MPV): it plays every format, Dolby
 * Digital and DTS sound included. The page keeps the keyboard; the controls
 * lie see-through over the picture in the app's overlay window, or, without
 * one, below the picture. Back closes it and returns the position reached,
 * like the Android TV native player.
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
    const muted = useRef(1);
    const overlay = useRef(overlayBridge());
    const bar = useRef<HTMLDivElement>(null);
    const session = useRef<DesktopMpvSession | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();
    const hiddenAt = useRef(0);
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
        // With the overlay window the picture always fills the window.
        const sync = () =>
            session.current?.setBounds(surface(bar.current, !overlay.current && (controls || !!failure || countdown)));
        sync();
        window.addEventListener('resize', sync);
        // The bar grows when tracks or the countdown appear: the picture
        // must move up with it, or it covers the title.
        const observer = typeof ResizeObserver === 'function' && bar.current ? new ResizeObserver(sync) : undefined;
        if (observer && bar.current) observer.observe(bar.current);
        return () => {
            window.removeEventListener('resize', sync);
            observer?.disconnect();
        };
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
    const shown = controls || !!failure || next?.countdown != null;
    const barState: PlayerBarState = {
        title: playback.title,
        isLive: !!playback.isLive,
        status,
        failure,
        position: state?.positionSeconds ?? 0,
        duration: state?.durationSeconds ?? null,
        volume: state?.volume ?? 1,
        audioTracks: state?.audioTracks ?? [],
        audioId: state?.selectedAudioTrackId ?? null,
        subtitleTracks: state?.subtitleTracks ?? [],
        subtitleId: state?.selectedSubtitleTrackId ?? null,
        ...(next && onNext ? { next } : {}),
        shown,
    };
    const handle = (command: PlayerBarCommand) => {
        const mpv = session.current;
        const at = mpv?.state;
        // Just closed by a click: the hand still moving the mouse must not
        // bring the controls straight back.
        if (command.type === 'activity' && Date.now() - hiddenAt.current < 900) return;
        if (command.type !== 'back' && command.type !== 'hide') reveal();
        if (command.type === 'back') close();
        else if (command.type === 'hide') {
            clearTimeout(hideTimer.current);
            hiddenAt.current = Date.now();
            setControls(false);
        }
        else if (command.type === 'toggle') mpv?.togglePause();
        else if (command.type === 'seekBy') mpv?.seekBy(command.seconds);
        else if (command.type === 'seekTo') mpv?.seekTo(command.seconds);
        else if (command.type === 'volume') mpv?.setVolume(command.value);
        else if (command.type === 'mute') toggleMute();
        else if (command.type === 'audio') cycleAudio();
        else if (command.type === 'subtitles') cycleSubtitles();
        else if (command.type === 'audioTrack') mpv?.setAudioTrack(command.id);
        else if (command.type === 'subtitleTrack') mpv?.setSubtitleTrack(command.id);
        else if (command.type === 'next') onNext?.(at?.positionSeconds ?? 0, at?.durationSeconds ?? at?.positionSeconds ?? 0);
        else if (command.type === 'cancelNext') onCancelNext?.();
    };
    const latestHandle = useRef(handle);
    latestHandle.current = handle;
    useEffect(() => {
        const bridge = overlay.current;
        if (!bridge) return;
        void bridge.open().catch(() => undefined);
        const stop = bridge.onCommand((command) => {
            if (command && typeof command === 'object' && 'type' in command) latestHandle.current(command as PlayerBarCommand);
        });
        return () => {
            stop();
            void bridge.close().catch(() => undefined);
        };
    }, []);
    overlay.current?.update(barState);
    return (
        <div class={`desktop-player ${shown ? '' : 'dormant'}`} data-tv-modal onMouseMove={reveal}>
            {/* With the overlay window the spinner rings Play there instead. */}
            {status === 'loading' && !failure && !overlay.current ? (
                <span class="spinner large desktop-player-spinner" aria-hidden="true" />
            ) : null}
            {overlay.current ? null : <PlayerBar state={barState} send={handle} barRef={bar} />}
        </div>
    );
}
