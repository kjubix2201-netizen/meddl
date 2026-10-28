import { t } from '@meddl/tv/util';
import { useEffect, useState } from 'preact/hooks';
import type { SoundPhase } from './sound-fallback';

type DecodeCounters = HTMLVideoElement & {
    webkitAudioDecodedByteCount?: number;
    webkitVideoDecodedByteCount?: number;
};

/**
 * Detects silent playback and reports it. Many IPTV movies, series and some
 * channels carry Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3) or DTS
 * audio, which Chromium-based browsers drop: the picture plays without
 * sound. Chromium exposes decoded byte counters; video bytes for a few
 * seconds without a single audio byte mean the format is not supported
 * here, and `onSilent` starts the sound fallback (sound-fallback.ts).
 * Without the counters (other engines) nothing is reported.
 */
export function AudioNotice({
    video,
    phase,
    progress,
    onSilent,
}: {
    video: HTMLVideoElement | null;
    phase: SoundPhase;
    progress?: number;
    onSilent: () => void;
}) {
    const [silent, setSilent] = useState(false);
    const source = video?.currentSrc ?? '';

    useEffect(() => {
        setSilent(false);
        const element = video as DecodeCounters | null;
        if (!element || element.webkitAudioDecodedByteCount === undefined) return;
        let checks = 0;
        const timer = setInterval(() => {
            if (element.paused || element.readyState < 3) return;
            checks += 1;
            const audio = element.webkitAudioDecodedByteCount ?? 0;
            const picture = element.webkitVideoDecodedByteCount ?? 0;
            if (audio > 0) {
                setSilent(false);
                clearInterval(timer);
            } else if (checks >= 4 && picture > 0) {
                setSilent(true);
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [video, source]);

    useEffect(() => {
        if (silent && phase === 'idle') onSilent();
    }, [silent, phase]);

    const message =
        phase === 'converting'
            ? t('Converting the sound for this device…')
            : phase === 'preparing'
              ? progress !== undefined
                  ? t('Setting up the sound conversion once on your meddl server… {percent} %', { percent: progress })
                  : t('Setting up the sound conversion once on your meddl server…')
            : phase === 'native'
              ? t('Opening the meddl player with Dolby / DTS sound…')
              : phase === 'server'
                ? t('Sound converted by your meddl server.')
                : phase === 'unavailable' && silent
                  ? t('No sound: this stream uses Dolby Digital or DTS. Install FFmpeg on the computer running the meddl server to convert it automatically, or use the meddl desktop app.')
                  : '';
    if (!message) return null;
    return (
        <p role="status" class={`audio-notice is-${phase}`}>
            {message}
        </p>
    );
}
