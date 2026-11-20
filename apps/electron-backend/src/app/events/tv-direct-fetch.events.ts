/**
 * Built-in server for the TV interface (apps/tv): the page asks the main
 * process to fetch provider addresses, because a web page may not read IPTV
 * provider answers (no CORS headers). Same contract as the Android app's
 * DirectFetch: GET http/https only, redirects followed, status and body
 * passed through. Addresses carry credentials and are never logged.
 */
import { ipcMain } from 'electron';
import { createTunnelFetch } from '../services/vpn-fetch';
import { vpnProxyUrl, vpnSocksAddress } from '../services/vpn-routing';

export const TV_DIRECT_FETCH = 'meddl:tv-direct-fetch';

export interface TvDirectFetchRequest {
    url?: unknown;
    headers?: unknown;
    timeoutMs?: unknown;
}

/** The part of `fetch` this handler uses. */
type DirectFetch = (
    url: string,
    init: {
        method: 'GET';
        headers: Record<string, string>;
        redirect: 'follow';
        signal: AbortSignal;
    }
) => Promise<{ status: number; text(): Promise<string> }>;

const tunnelFetch = createTunnelFetch(vpnSocksAddress);

/**
 * Through the built-in VPN while it routes meddl's traffic (also for the
 * phones served by home-network-server.ts), else directly. Routed requests
 * fail when the tunnel is down; they never go out beside it.
 */
function routedFetch(): DirectFetch {
    return vpnProxyUrl() !== null ? tunnelFetch : fetch;
}

export async function tvDirectFetch(
    request: TvDirectFetchRequest,
    fetchImpl: DirectFetch = routedFetch()
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
