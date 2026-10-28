import { useEffect, useRef, useState } from 'preact/hooks';
import { startConversion } from '@meddl/tv/data-access';
import { mediaTitle } from '@meddl/tv/util';
import type { TvModel } from './use-tv';

export type SoundPhase = 'idle' | 'converting' | 'server' | 'native' | 'unavailable';

/** Android TV / Fire TV shell (apps/android-tv) with its own decoders. */
type AndroidBridge = { playNative?: (request: string) => void };
type NativeClosed = (positionMs: number, durationMs: number) => void;

function androidBridge(): AndroidBridge | undefined {
    return (window as unknown as { MeddlAndroid?: AndroidBridge }).MeddlAndroid;
}

/**
 * Silent sound (Dolby Digital, DTS … the page cannot decode) is fixed
 * without asking: the Android app hands the stream to its native player,
 * which decodes these formats; elsewhere the meddl server converts the
 * sound to AAC and the title continues at the same position.
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

    async function silent() {
        const player = tv.player.current;
        if (!item || !player || player.isConverted || phase !== 'idle') return;
        const url = player.lastPlayback?.url;
        if (!url) return;
        const id = item.id;
        const position = player.position;
        const knownLength = Number.isFinite(player.length) ? player.length : undefined;
        const source = tv.data.sources.find((s) => s.id === item.sourceId);
        const android = androidBridge();
        if (android?.playNative) {
            player.pause();
            android.playNative(
                JSON.stringify({
                    url,
                    title: mediaTitle(item),
                    startMs: item.kind === 'live' ? 0 : Math.round(position * 1000),
                    live: item.kind === 'live',
                    userAgent: source?.userAgent ?? '',
                })
            );
            setState({ id, phase: 'native' });
            return;
        }
        if (!tv.data.backend) {
            setState({ id, phase: 'unavailable' });
            return;
        }
        setState({ id, phase: 'converting' });
        try {
            const conversion = await startConversion(
                tv.data.backend,
                tv.data.backendToken,
                url,
                new AbortController().signal,
                source?.userAgent
            );
            if (latest.current.playing?.id !== id) return;
            await player.playConverted(item, conversion.url, position, conversion.duration ?? knownLength);
            setState({ id, phase: 'server' });
        } catch {
            if (latest.current.playing?.id === id) setState({ id, phase: 'unavailable' });
        }
    }
    return { phase, silent };
}
