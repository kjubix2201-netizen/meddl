import { useEffect, useRef, useState } from 'preact/hooks';
import { desktopMpvAvailable, type DesktopMpvPlayback } from '@meddl/tv/data-access';
import { mediaTitle } from '@meddl/tv/util';
import type { TvModel } from './use-tv';
import { alwaysAppPlayer } from './app-player-setting';

/** `done`: the desktop MPV player was closed; the page does not reopen it. */
export type SoundPhase = 'idle' | 'native' | 'desktop' | 'done' | 'unavailable';

/** Android TV / Fire TV shell (apps/android-tv) with its own decoders. */
type AndroidBridge = { playNative?: (request: string) => void };
type NativeClosed = (positionMs: number, durationMs: number) => void;

function androidBridge(): AndroidBridge | undefined {
    return (window as unknown as { MeddlAndroid?: AndroidBridge }).MeddlAndroid;
}

/**
 * Silent sound (Dolby Digital, DTS … the page cannot decode): the Android
 * app hands the stream to its native player and the desktop app to its MPV
 * player (desktop-player.tsx); both decode these formats and continue at the
 * same position. Live channels and streams the page cannot play at all go
 * there directly. A browser without Dolby support shows a hint to use the
 * meddl apps instead.
 */
export function useSoundFallback(tv: TvModel) {
    const [state, setState] = useState<{ id: string; phase: SoundPhase; desktop?: DesktopMpvPlayback }>({
        id: '',
        phase: 'idle',
    });
    const item = tv.playing;
    const phase: SoundPhase = item && state.id === item.id ? state.phase : 'idle';
    const desktop = phase === 'desktop' ? state.desktop : undefined;
    const latest = useRef(tv);
    latest.current = tv;
    const silentRef = useRef<() => void>(() => undefined);
    // The app's own player went on to the next episode: it plays there too.
    const sticky = useRef(false);

    const closed: NativeClosed = (positionMs, durationMs) => {
        const current = latest.current;
        current.player.current?.recordExternal(positionMs / 1000, durationMs / 1000);
        if (current.fullscreen) current.back();
    };
    /** The desktop MPV player closed at this position (seconds). */
    const desktopClosed = (positionSeconds: number, durationSeconds: number) => {
        sticky.current = false;
        setState((previous) => ({ id: previous.id, phase: 'done' }));
        closed(positionSeconds * 1000, durationSeconds * 1000);
    };

    /** The app's own player continues with the next episode. */
    const desktopContinue = (positionSeconds: number, durationSeconds: number) => {
        latest.current.player.current?.recordExternal(positionSeconds, durationSeconds);
        sticky.current = true;
    };

    useEffect(() => {
        (window as unknown as { meddlNativeClosed?: NativeClosed }).meddlNativeClosed = closed;
        return () => {
            delete (window as unknown as { meddlNativeClosed?: NativeClosed }).meddlNativeClosed;
        };
    }, []);

    // The page cannot play the stream at all (live .ts, unsupported codecs):
    // the app's own player takes over instead of showing the error.
    useEffect(() => {
        const failed = /^(This stream could not be played|Playback did not start)/.test(tv.error);
        if (failed && item && phase === 'idle' && (androidBridge()?.playNative || desktopMpvAvailable())) {
            silent();
            tv.setError('');
        }
    }, [tv.error, phase, item?.id]);

    // Live channels start in the app's own engine right away, like other
    // IPTV players do: raw transport streams and Dolby/DTS are its strength.
    useEffect(() => {
        const direct =
            (item?.kind === 'live' && tv.fullscreen) ||
            (item?.kind !== 'live' && (sticky.current || (tv.fullscreen && alwaysAppPlayer())));
        if (!item || !direct || phase !== 'idle' || !(androidBridge()?.playNative || desktopMpvAvailable())) return;
        const id = item.id;
        let tries = 0;
        const timer = setInterval(() => {
            const player = latest.current.player.current;
            if (player?.item?.id === id && player.lastPlayback?.url) {
                clearInterval(timer);
                silentRef.current();
            } else if (++tries > 40) clearInterval(timer);
        }, 150);
        return () => clearInterval(timer);
    }, [item?.id, phase, tv.fullscreen]);

    function silent() {
        const player = tv.player.current;
        if (!item || !player || phase !== 'idle') return;
        const url = player.lastPlayback?.url;
        const android = androidBridge();
        const source = tv.data.sources.find((s) => s.id === item.sourceId);
        const live = item.kind === 'live';
        if (url && !android?.playNative && desktopMpvAvailable()) {
            player.pause();
            setState({
                id: item.id,
                phase: 'desktop',
                desktop: {
                    streamUrl: url,
                    title: mediaTitle(item),
                    isLive: live,
                    ...(live ? {} : { startTime: Math.max(0, Math.floor(player.handoverPosition)) }),
                    ...(source?.userAgent ? { userAgent: source.userAgent } : {}),
                },
            });
            return;
        }
        if (!url || !android?.playNative) {
            setState({ id: item.id, phase: 'unavailable' });
            return;
        }
        player.pause();
        android.playNative(
            JSON.stringify({
                url,
                title: mediaTitle(item),
                startMs: live ? 0 : Math.round(player.handoverPosition * 1000),
                live,
                userAgent: source?.userAgent ?? '',
            })
        );
        setState({ id: item.id, phase: 'native' });
    }
    silentRef.current = silent;
    return { phase, silent, desktop, desktopClosed, desktopContinue };
}
