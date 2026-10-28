import { backendJson } from './backend';

export interface Conversion {
    /** Stream address with converted sound, starting at `start` seconds. */
    url: (start: number) => string;
    duration?: number;
    audio?: string;
}

/**
 * Asks the meddl server to convert a stream's sound (Dolby Digital, DTS …)
 * to AAC. The server checks the address like every provider request and
 * answers with a one-off stream id; the <video> element then opens that id
 * without needing the access token.
 */
export async function startConversion(
    backend: string,
    token: string,
    url: string,
    signal: AbortSignal,
    userAgent?: string
): Promise<Conversion> {
    const base = backend.replace(/\/$/, '');
    const result = (await backendJson(
        `${base}/transcode/session`,
        signal,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ url, ...(userAgent ? { userAgent } : {}) }),
        },
        25000
    )) as { path?: string; duration?: number; audio?: string };
    if (!result.path) throw new Error('The meddl server did not start the conversion.');
    const stream = `${base}${result.path}`;
    return {
        url: (start) => (start > 0 ? `${stream}?start=${start.toFixed(1)}` : stream),
        ...(result.duration ? { duration: result.duration } : {}),
        ...(result.audio ? { audio: result.audio } : {}),
    };
}
