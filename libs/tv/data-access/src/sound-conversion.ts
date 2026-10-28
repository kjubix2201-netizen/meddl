export interface Conversion {
    /** Stream address with converted sound, starting at `start` seconds. */
    url: (start: number) => string;
    duration?: number;
    audio?: string;
}

/** The server is still fetching FFmpeg (once, Windows); ask again soon. */
export class ConversionPreparing extends Error {
    constructor(
        readonly received: number,
        readonly total: number
    ) {
        super('The meddl server is setting up the sound conversion.');
    }
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
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel);
    const timer = setTimeout(cancel, 25000);
    try {
        const response = await fetch(`${base}/transcode/session`, {
            method: 'POST',
            signal: abort.signal,
            cache: 'no-store',
            redirect: 'error',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ url, ...(userAgent ? { userAgent } : {}) }),
        });
        const result = (await response.json().catch(() => ({}))) as {
            path?: string;
            duration?: number;
            audio?: string;
            code?: string;
            setup?: { phase?: string; received?: number; total?: number };
        };
        if (response.status === 503 && result.code === 'ffmpeg-preparing')
            throw new ConversionPreparing(result.setup?.received ?? 0, result.setup?.total ?? 0);
        if (!response.ok || !result.path)
            throw new Error('The meddl server did not start the conversion.');
        const stream = `${base}${result.path}`;
        return {
            url: (start) => (start > 0 ? `${stream}?start=${start.toFixed(1)}` : stream),
            ...(result.duration ? { duration: result.duration } : {}),
            ...(result.audio ? { audio: result.audio } : {}),
        };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}
