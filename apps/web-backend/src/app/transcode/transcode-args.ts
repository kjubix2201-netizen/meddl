/**
 * FFmpeg command lines for the audio conversion ("sound for every device").
 * Kept free of Node APIs so the rules can be tested on their own.
 */

/** Protocols FFmpeg may open: network only, never local files. */
export const PROTOCOLS = 'http,https,tcp,tls,crypto,hls';

export interface TranscodeInput {
    url: string;
    /** Seconds from the start of a movie or episode; 0 for live. */
    start: number;
    userAgent?: string;
}

/**
 * Picture is passed through untouched (no CPU cost, no quality loss); the
 * first audio track becomes stereo AAC, which every browser, TV and box
 * decodes. Output is fragmented MP4 so playback starts while it streams.
 *
 * Lip sync when starting mid-title: a copied picture can only begin at a
 * keyframe, often seconds before the requested second, while FFmpeg would
 * trim the re-encoded sound to the exact second, so picture and sound end
 * up seconds apart. `-noaccurate_seek` starts the sound at that same
 * keyframe; both tracks then share one zero point (`make_zero`).
 */
export function transcodeArgs(input: TranscodeInput): string[] {
    const start = Number.isFinite(input.start) && input.start > 0 ? input.start : 0;
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        PROTOCOLS,
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        ...(input.userAgent ? ['-user_agent', input.userAgent] : []),
        ...(start ? ['-noaccurate_seek', '-ss', start.toFixed(1)] : []),
        '-i',
        input.url,
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '192k',
        // Small gaps in live sound are filled instead of shifting what follows.
        '-af',
        'aresample=async=1:first_pts=0',
        '-avoid_negative_ts',
        'make_zero',
        '-max_muxing_queue_size',
        '1024',
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1',
    ];
}

/** Duration and audio codec of a source, read with ffprobe. */
export function probeArgs(url: string, userAgent?: string): string[] {
    return [
        '-v',
        'error',
        '-protocol_whitelist',
        PROTOCOLS,
        ...(userAgent ? ['-user_agent', userAgent] : []),
        '-show_entries',
        'format=duration:stream=codec_type,codec_name',
        '-of',
        'json',
        url,
    ];
}

export interface ProbeResult {
    duration?: number;
    audio?: string;
}

export function parseProbe(output: string): ProbeResult {
    try {
        const data = JSON.parse(output) as {
            format?: { duration?: string };
            streams?: { codec_type?: string; codec_name?: string }[];
        };
        const duration = Number(data.format?.duration);
        const audio = data.streams?.find((s) => s.codec_type === 'audio')?.codec_name;
        return {
            ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
            ...(audio ? { audio } : {}),
        };
    } catch {
        return {};
    }
}
