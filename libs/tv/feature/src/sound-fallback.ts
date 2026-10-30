import { useEffect, useRef, useState } from 'preact/hooks';
import { desktopMpvAvailable, type DesktopMpvPlayback } from '@meddl/tv/data-access';
import { mediaTitle, t } from '@meddl/tv/util';
import type { TvModel } from './use-tv';
import { alwaysAppPlayer } from './app-player-setting';

/** `done`: the desktop MPV player was closed; the page does not reopen it. */
export type SoundPhase = 'idle' | 'native' | 'desktop' | 'done' | 'unavailable';

/** Android TV / Fire TV shell (apps/android-tv) with its own decoders. */
type AndroidBridge = { playNative?: (request: string) => void };
type NativeClosed = (positionMs: number, durationMs: number, next?: boolean) => void;

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

    // The series' next episode, set by app.tsx from useNextEpisode.
    const nextEpisode = useRef<{ title: string; play: () => void } | undefined>();
    const closed: NativeClosed = (positionMs, durationMs, next) => {
        const current = latest.current;
        current.player.current?.recordExternal(positionMs / 1000, durationMs / 1000);
        const upcoming = nextEpisode.current;
        if (next && upcoming) {
            // The native player went on: the next episode plays there too.
            sticky.current = true;
            upcoming.play();
            return;
        }
        sticky.current = false;
        // Live: nothing keeps playing in the page (it could not anyway), so
        // the list is back and the same channel can be chosen again.
        if (current.playing?.kind === 'live') current.stop();
        else if (current.fullscreen) current.back();
    };
    /** The desktop MPV player closed at this position (seconds). */
    const desktopClosed = (positionSeconds: number, durationSeconds: number) => {
        sticky.current = false;
        setState((previous) => ({ id: previous.id, phase: 'done' }));
        closed(positionSeconds * 1000, durationSeconds * 1000);
    };

    // Nothing plays any more: the next start of the same title is a new one.
    useEffect(() => {
        if (!item) setState((previous) => (previous.id ? { id: '', phase: 'idle' } : previous));
    }, [item?.id]);

    /**
     * Channel up / down inside the app's own player: the neighbouring
     * channel of the list plays there as well (sticky).
     */
    const zap = (direction: number) => {
        const current = latest.current;
        const channels = current.catalog.items.filter((m) => m.kind === 'live');
        const at = channels.findIndex((m) => m.id === current.playing?.id);
        const next = at >= 0 ? channels[at + (direction > 0 ? 1 : -1)] : undefined;
        if (!next) return false;
        sticky.current = true;
        current.setSelected(next);
        void current.play(next);
        return true;
    };

    /** The app's own player continues with the next episode. */
    const desktopContinue = (positionSeconds: number, durationSeconds: number) => {
        latest.current.player.current?.recordExternal(positionSeconds, durationSeconds);
        sticky.current = true;
    };

    useEffect(() => {
        const shell = window as unknown as { meddlNativeClosed?: NativeClosed; meddlZap?: (direction: number) => boolean };
        shell.meddlNativeClosed = closed;
        shell.meddlZap = zap;
        return () => {
            delete shell.meddlNativeClosed;
            delete shell.meddlZap;
        };
    }, []);

    // The page cannot play the stream at all (live .ts, unsupported codecs):
    // the app's own player takes over, without showing the error first.
    tv.playbackFailure.current = (message) => {
        const failed = /^(This stream could not be played|Playback did not start)/.test(message);
        if (!failed || !item || phase !== 'idle' || !(androidBridge()?.playNative || desktopMpvAvailable())) return false;
        silent();
        return true;
    };

    /**
     * True when the app's own player plays this title from the start. Live:
     * in full screen, and with "always" also from the list (the page cannot
     * preview most live streams in these apps). Films and series: with
     * "always", or once the app's player went on to the next episode.
     */
    const takesOver = (media: { kind: string }) => {
        if (!(androidBridge()?.playNative || desktopMpvAvailable())) return false;
        return media.kind === 'live'
            ? latest.current.fullscreen || alwaysAppPlayer() || sticky.current
            : sticky.current || alwaysAppPlayer();
    };
    if (tv.player.current) tv.player.current.deferToApp = takesOver;

    // Live channels start in the app's own engine right away, like other
    // IPTV players do: raw transport streams and Dolby/DTS are its strength.
    useEffect(() => {
        if (!item || phase !== 'idle' || !takesOver(item)) return;
        const id = item.id;
        let tries = 0;
        const timer = setInterval(() => {
            const player = latest.current.player.current;
            if (player?.item?.id === id && player.lastPlayback?.url) {
                clearInterval(timer);
                silentRef.current();
            } else if (++tries > 40) clearInterval(timer);
        }, 50);
        return () => clearInterval(timer);
    }, [item?.id, phase, tv.fullscreen]);

    function silent() {
        const player = tv.player.current;
        if (!item || !player || phase !== 'idle') return;
        const url = player.lastPlayback?.url;
        const android = androidBridge();
        const source = tv.data.sources.find((s) => s.id === item.sourceId);
        const live = item.kind === 'live';
        // Read before handOver(), which ends the page's position restore.
        const start = live ? 0 : Math.max(0, player.handoverPosition);
        if (url && !android?.playNative && desktopMpvAvailable()) {
            player.handOver();
            setState({
                id: item.id,
                phase: 'desktop',
                desktop: {
                    streamUrl: url,
                    title: mediaTitle(item),
                    isLive: live,
                    ...(live ? {} : { startTime: Math.floor(start) }),
                    ...(source?.userAgent ? { userAgent: source.userAgent } : {}),
                },
            });
            return;
        }
        if (!url || !android?.playNative) {
            setState({ id: item.id, phase: 'unavailable' });
            return;
        }
        player.handOver();
        android.playNative(
            JSON.stringify({
                url,
                title: mediaTitle(item),
                startMs: Math.round(start * 1000),
                live,
                userAgent: source?.userAgent ?? '',
                ...(!live && nextEpisode.current
                    ? {
                          nextTitle: nextEpisode.current.title,
                          nextLabel: t('Next episode in {seconds} s: {title}'),
                          playNowLabel: t('Play now'),
                          cancelLabel: t('Cancel'),
                      }
                    : {}),
            })
        );
        setState({ id: item.id, phase: 'native' });
    }
    silentRef.current = silent;
    /**
     * The Android app's own player takes (or took) this title: the page
     * shows no player of its own meanwhile, only a quiet handover screen.
     */
    const handingOver =
        !!item &&
        !!androidBridge()?.playNative &&
        (phase === 'native' || (phase === 'idle' && takesOver(item)));
    return { phase, silent, desktop, desktopClosed, desktopContinue, nextEpisode, zap, handingOver };
}
