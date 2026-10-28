/**
 * Built-in server for the TV interface (apps/tv): the page asks the main
 * process to fetch provider addresses, because a web page may not read IPTV
 * provider answers (no CORS headers). Same contract as the Android app's
 * DirectFetch: GET http/https only, redirects followed, status and body
 * passed through. Addresses carry credentials and are never logged.
 */
import { ipcMain } from 'electron';

export const TV_DIRECT_FETCH = 'meddl:tv-direct-fetch';

export interface TvDirectFetchRequest {
    url?: unknown;
    headers?: unknown;
    timeoutMs?: unknown;
}

export async function tvDirectFetch(
    request: TvDirectFetchRequest,
    fetchImpl: typeof fetch = fetch
): Promise<{ status: number; body: string }> {
    const url = typeof request.url === 'string' ? new URL(request.url) : null;
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:'))
        throw new Error('Only http and https addresses are allowed.');
    const headers: Record<string, string> = {};
    if (request.headers && typeof request.headers === 'object')
        for (const [key, value] of Object.entries(request.headers as Record<string, unknown>))
            if (typeof value === 'string') headers[key] = value;
    const timeout = Math.min(300_000, Math.max(1_000, Number(request.timeoutMs) || 30_000));
    const response = await fetchImpl(url.href, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
    });
    return { status: response.status, body: await response.text() };
}

export function registerTvDirectFetchHandler(): void {
    ipcMain.handle(TV_DIRECT_FETCH, (_event, request: TvDirectFetchRequest) =>
        tvDirectFetch(request ?? {})
    );
}
