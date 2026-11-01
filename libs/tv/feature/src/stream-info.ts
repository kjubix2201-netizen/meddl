import type { DesktopMpvState } from '@meddl/tv/data-access';

const CODECS: Record<string, string> = {
    h264: 'H.264',
    hevc: 'HEVC',
    h265: 'HEVC',
    av1: 'AV1',
    vp9: 'VP9',
    mpeg2video: 'MPEG-2',
    ac3: 'Dolby Digital',
    eac3: 'Dolby Digital+',
    truehd: 'Dolby TrueHD',
    dts: 'DTS',
    aac: 'AAC',
    mp2: 'MP2',
    mp3: 'MP3',
    opus: 'Opus',
};

function codec(name?: string) {
    if (!name) return undefined;
    return CODECS[name.toLowerCase()] ?? name.toUpperCase();
}

function mbit(bps?: number) {
    return bps && bps > 0 ? `${(bps / 1_000_000).toFixed(1)} Mbit/s` : undefined;
}

/** "1920×1080 · 50 fps · H.264 · 6.2 Mbit/s", "Dolby Digital · 5.1 · 0.4 Mbit/s", buffer. */
export function streamInfoLines(state: DesktopMpvState | null | undefined): string[] {
    const stats = state?.stats ?? {};
    const video = [
        state?.videoWidth && state.videoHeight ? `${state.videoWidth}×${state.videoHeight}` : undefined,
        stats.fps ? `${Math.round(stats.fps)} fps` : undefined,
        codec(stats.videoCodec),
        mbit(stats.videoBitrateBps),
    ].filter(Boolean);
    const audio = [codec(stats.audioCodec), stats.audioChannels, mbit(stats.audioBitrateBps)].filter(Boolean);
    const lines = [video.join(' · '), audio.join(' · ')].filter((line) => line.length > 0);
    const extra = [
        stats.container ? stats.container.toUpperCase() : undefined,
        stats.bufferedAheadSeconds !== undefined ? `Buffer ${Math.round(stats.bufferedAheadSeconds)} s` : undefined,
        stats.droppedFrames ? `${stats.droppedFrames} dropped` : undefined,
    ].filter(Boolean);
    if (extra.length) lines.push(extra.join(' · '));
    return lines.length ? lines : ['…'];
}
