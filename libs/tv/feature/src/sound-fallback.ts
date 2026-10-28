import { useEffect, useRef, useState } from 'preact/hooks';
import { mediaTitle } from '@meddl/tv/util';
import type { TvModel } from './use-tv';

export type SoundPhase = 'idle' | 'native' | 'unavailable';

/** Android TV / Fire TV shell (apps/android-tv) with its own decoders. */
type AndroidBridge = { playNative?: (request: string) => void };
type NativeClosed = (positionMs: number, durationMs: number) => void;

function androidBridge(): AndroidBridge | undefined {
    return (window as unknown as { MeddlAndroid?: AndroidBridge }).MeddlAndroid;
}

/**
 * Silent sound (Dolby Digital, DTS … the page cannot decode): the Android
 * app hands the stream to its native player, which decodes these formats,
 * and continues at the same position. A browser without Dolby support
 * shows a hint to use the meddl apps instead.
 */
export function useSoundFallback(tv: TvModel) {
    const [state, setState] = useState<{ id: string; phase: SoundPhase }>({ id: '', phase: 'idle' });
    const item = tv.playing;
    const phase: SoundPhase = item && state.id === item.id ? state.phase : 'idle';
    const latest = useRef(tv);
    latest.current = tv;

    useEffect(() => {
        const closed: NativeClosed = (positionMs, durationMs) => {
            const current = latest.current;
            current.player.current?.recordExternal(positionMs / 1000, durationMs / 1000);
            if (current.fullscreen) current.back();
        };
        (window as unknown as { meddlNativeClosed?: NativeClosed }).meddlNativeClosed = closed;
        return () => {
            delete (window as unknown as { meddlNativeClosed?: NativeClosed }).meddlNativeClosed;
        };
    }, []);

    function silent() {
        const player = tv.player.current;
        if (!item || !player || phase !== 'idle') return;
        const url = player.lastPlayback?.url;
        const android = androidBridge();
        if (!url || !android?.playNative) {
            setState({ id: item.id, phase: 'unavailable' });
            return;
        }
        const source = tv.data.sources.find((s) => s.id === item.sourceId);
        player.pause();
        android.playNative(
            JSON.stringify({
                url,
                title: mediaTitle(item),
                startMs: item.kind === 'live' ? 0 : Math.round(player.position * 1000),
                live: item.kind === 'live',
                userAgent: source?.userAgent ?? '',
            })
        );
        setState({ id: item.id, phase: 'native' });
    }
    return { phase, silent };
}
