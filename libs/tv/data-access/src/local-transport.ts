import parser from 'iptv-playlist-parser';
import {
    buildStalkerIdentityRequestContext,
    buildStalkerRequestUrl,
    normalizeXtreamServerUrl,
} from '@meddl/shared/interfaces';
import { extractDrmFromRaw } from '@meddl/shared/m3u-utils';
import type { Source } from '@meddl/tv/util';
import { directFetch } from './direct-fetch';
import {
    isFullListRequest,
    ProviderRequestError,
    ProviderTransport,
} from './transport';

const XTREAM_MS = 30000;
const FULL_LIST_MS = 60000;
/** Panels treat unknown clients as scrapers and throttle them. */
const PLAYER_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
const STALKER_MS = 15000;
const STALKER_LINK_MS = 30000;
const PLAYLIST_MS = 60000;
/** Stalker credentials travel as headers, never in the portal query. */
const STALKER_CREDENTIALS = ['macAddress', 'token', 'serialNumber', 'skipConnectionGuard'];

function parseBody(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * The meddl server's provider routes, run inside the app itself: the same
 * Xtream, Stalker and playlist requests the web backend makes, sent through
 * the app's direct line (direct-fetch.ts). With it the Android TV and desktop
 * apps work on their own, without a meddl server on another computer.
 */
export class LocalTransport extends ProviderTransport {
    constructor() {
        super('http://meddl.local');
    }

    override async request(
        source: Source,
        route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>,
        signal: AbortSignal,
        endpoint = source.endpoint ?? source.url
    ): Promise<unknown> {
        if (route === 'xtream') return this.xtream(endpoint, params, signal);
        if (route === 'stalker') return this.stalker(endpoint, params, signal);
        return this.playlist(endpoint, source.userAgent, signal);
    }

    private async get(url: string, headers: Record<string, string>, signal: AbortSignal, timeout: number) {
        let response;
        try {
            response = await directFetch(url, headers, signal, timeout);
        } catch (error) {
            if (signal.aborted) throw error;
            throw new ProviderRequestError(502, true);
        }
        if (response.status >= 400) throw new ProviderRequestError(response.status, true);
        return response.text;
    }

    private async xtream(endpoint: string, params: Record<string, string | number>, signal: AbortSignal) {
        const url = new URL(`${normalizeXtreamServerUrl(endpoint)}/player_api.php`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
        // A whole section that is not answered within a minute is then loaded
        // per category (xtream.ts); that is how other players get through.
        const timeout = isFullListRequest(params) ? FULL_LIST_MS : XTREAM_MS;
        return parseBody(await this.get(url.href, { 'User-Agent': PLAYER_USER_AGENT }, signal, timeout));
    }

    private async stalker(endpoint: string, all: Record<string, string | number>, signal: AbortSignal) {
        const text = (key: string) => (all[key] === undefined ? undefined : String(all[key]));
        const macAddress = text('macAddress');
        const token = text('token');
        const serialNumber = text('serialNumber');
        const params: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(all))
            if (!STALKER_CREDENTIALS.includes(key)) params[key] = value;
        if (params['action'] === 'handshake' && token) params['token'] = token;
        const identity = buildStalkerIdentityRequestContext({
            macAddress: macAddress ?? '',
            params,
            ...(token ? { token } : {}),
            ...(serialNumber ? { serialNumber } : {}),
        });
        const headers: Record<string, string> = { ...identity.headers };
        if (!macAddress) delete headers['Cookie'];
        const url = buildStalkerRequestUrl(endpoint, identity.requestParams);
        const timeout = params['action'] === 'create_link' ? STALKER_LINK_MS : STALKER_MS;
        return parseBody(await this.get(url, headers, signal, timeout));
    }

    private async playlist(url: string, userAgent: string | undefined, signal: AbortSignal) {
        const body = await this.get(url, userAgent ? { 'User-Agent': userAgent } : {}, signal, PLAYLIST_MS);
        const parsed = parser.parse(body) as unknown as { items: Array<Record<string, unknown>> };
        return {
            playlist: {
                ...parsed,
                items: parsed.items.map((item) => {
                    const drm = extractDrmFromRaw(typeof item['raw'] === 'string' ? item['raw'] : undefined);
                    return drm ? { ...item, drm } : item;
                }),
            },
        };
    }
}
