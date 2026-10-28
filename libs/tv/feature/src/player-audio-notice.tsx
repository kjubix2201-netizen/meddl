import { t } from '@meddl/tv/util';
import { useEffect, useState } from 'preact/hooks';

type DecodeCounters = HTMLVideoElement & {
    webkitAudioDecodedByteCount?: number;
    webkitVideoDecodedByteCount?: number;
};

/**
 * Explains silent playback. Many IPTV movies, series and some channels carry
 * Dolby Digital (AC-3), Dolby Digital Plus (E-AC-3) or DTS audio. Televisions
 * decode those, but Chromium-based desktop browsers do not: the picture plays
 * and the sound is silently dropped. Chromium exposes decoded byte counters;
 * if video is being decoded for a few seconds while no audio byte arrives,
 * the stream's audio format is not supported here. Without the counters
 * (other engines) nothing is shown, since the cause cannot be told apart.
 */
export function AudioNotice({ video }: { video: HTMLVideoElement | null }) {
    const [silent, setSilent] = useState(false);
    const source = video?.currentSrc ?? '';

    useEffect(() => {
        setSilent(false);
        const element = video as DecodeCounters | null;
        if (!element || element.webkitAudioDecodedByteCount === undefined)
            return;
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

    if (!silent) return null;
    return (
        <p role="status" class="audio-notice">
            {t("No sound: this stream's audio format (probably Dolby Digital or DTS) is not supported by this browser. It plays with sound on TVs and Fire TV, and in the meddl desktop app with MPV or VLC as player.")}
        </p>
    );
}
