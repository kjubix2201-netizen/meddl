import { useEffect, useRef, useState } from 'preact/hooks';
import { ConversionPreparing, startConversion, type Conversion } from '@meddl/tv/data-access';
import { mediaTitle } from '@meddl/tv/util';
import type { TvModel } from './use-tv';

export type SoundPhase = 'idle' | 'converting' | 'preparing' | 'server' | 'native' | 'unavailable';

const PREPARE_POLL_MS = 3000;
const PREPARE_LIMIT_MS = 15 * 60 * 1000;

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
    const [state, setState] = useState<{ id: string; phase: SoundPhase; progress?: number; reason?: string }>({
        id: '',
        phase: 'idle',
    });
    const item = tv.playing;
    const phase: SoundPhase = item && state.id === item.id ? state.phase : 'idle';
    const progress = item && state.id === item.id ? state.progress : undefined;
    const reason = item && state.id === item.id ? state.reason : undefined;
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
        const deadline = Date.now() + PREPARE_LIMIT_MS;
        try {
            let conversion: Conversion | undefined;
            for (;;) {
                try {
                    conversion = await startConversion(
                        tv.data.backend,
                        tv.data.backendToken,
                        url,
                        new AbortController().signal,
                        source?.userAgent
                    );
                    break;
                } catch (error) {
                    // First use on a Windows server: it fetches FFmpeg once.
                    if (!(error instanceof ConversionPreparing) || Date.now() > deadline) throw error;
                    if (latest.current.playing?.id !== id) return;
                    setState({
                        id,
                        phase: 'preparing',
                        progress: error.total ? Math.round((error.received / error.total) * 100) : undefined,
                    });
                    await new Promise((resolve) => setTimeout(resolve, PREPARE_POLL_MS));
                    if (latest.current.playing?.id !== id) return;
                }
            }
            if (!conversion) return;
            setState({ id, phase: 'converting' });
            await player.playConverted(item, conversion.url, position, conversion.duration ?? knownLength);
            setState({ id, phase: 'server' });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn('[meddl] sound conversion failed:', reason);
            if (latest.current.playing?.id === id) setState({ id, phase: 'unavailable', reason });
        }
    }
    return { phase, progress, reason, silent };
}
