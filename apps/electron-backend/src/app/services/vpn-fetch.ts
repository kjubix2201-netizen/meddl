import { request, type IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import {
    createBrotliDecompress,
    createGunzip,
    createInflate,
} from 'node:zlib';
import { socksConnect, type SocksAddress } from './vpn-http-bridge';

/**
 * GET through the built-in VPN for the main process's own requests (the TV
 * interface's provider traffic, tv-direct-fetch.events.ts). Node's `fetch`
 * knows no SOCKS proxy; this is the part of `fetch` that code uses: request
 * headers, redirects followed, a time limit, the status and the text. No
 * cookie jar and no cache, like `fetch` there. A request either travels
 * through the tunnel or fails; it never goes out directly.
 */

const MAX_REDIRECTS = 10;

export interface TunnelFetchInit {
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

export interface TunnelFetchResponse {
    status: number;
    text(): Promise<string>;
}

export type TunnelFetch = (
    url: string,
    init?: TunnelFetchInit
) => Promise<TunnelFetchResponse>;

function open(
    socks: SocksAddress,
    url: URL,
    headers: Record<string, string>,
    signal: AbortSignal | undefined
): Promise<IncomingMessage> {
    const secure = url.protocol === 'https:';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = Number(url.port) || (secure ? 443 : 80);
    return socksConnect(socks, host, port).then(
        (socket) =>
            new Promise<IncomingMessage>((resolve, reject) => {
                const stream: Duplex = secure
                    ? tlsConnect({
                          socket,
                          // Certificates are checked against the name asked for.
                          servername: isIP(host) ? undefined : host,
                          ALPNProtocols: ['http/1.1'],
                      })
                    : socket;
                stream.once('error', reject);
                const outgoing = request({
                    // No `agent` option at all: only then does Node use
                    // this connection instead of opening one of its own
                    // (which would go out beside the tunnel).
                    createConnection: () => stream as never,
                    setHost: false,
                    method: 'GET',
                    path: `${url.pathname}${url.search}`,
                    headers: {
                        ...headers,
                        host: url.host,
                        connection: 'close',
                        'accept-encoding': 'gzip, deflate, br',
                    },
                    signal,
                });
                outgoing.once('error', (error) => {
                    stream.destroy();
                    reject(error);
                });
                outgoing.once('response', resolve);
                outgoing.end();
            })
    );
}

function decoded(response: IncomingMessage): NodeJS.ReadableStream {
    const encoding = String(response.headers['content-encoding'] ?? '')
        .trim()
        .toLowerCase();
    if (encoding === 'gzip' || encoding === 'x-gzip') {
        return response.pipe(createGunzip());
    }
    if (encoding === 'deflate') {
        return response.pipe(createInflate());
    }
    if (encoding === 'br') {
        return response.pipe(createBrotliDecompress());
    }
    return response;
}

/** As fetch does: a byte-order mark is not part of the text. */
function withoutByteOrderMark(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readText(response: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const body = decoded(response);
        response.once('error', reject);
        body.once('error', reject);
        body.on('data', (chunk: Buffer) => chunks.push(chunk));
        body.once('end', () =>
            resolve(withoutByteOrderMark(Buffer.concat(chunks).toString('utf8')))
        );
    });
}

/** Header names in lower case, so a caller's spelling cannot double one. */
function normalized(headers: Record<string, string> = {}) {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        result[name.toLowerCase()] = value;
    }
    return result;
}

export function createTunnelFetch(
    socks: () => SocksAddress | null
): TunnelFetch {
    return async (address, init = {}) => {
        let url = new URL(address);
        let headers = normalized(init.headers);
        for (let hop = 0; ; hop++) {
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error('Only http and https addresses are allowed.');
            }
            const tunnel = socks();
            if (!tunnel) {
                throw new Error('The VPN is not connected.');
            }
            init.signal?.throwIfAborted();
            const response = await open(tunnel, url, headers, init.signal);
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (![301, 302, 303, 307, 308].includes(status) || !location) {
                const text = await readText(response);
                return { status, text: async () => text };
            }
            response.resume();
            if (hop >= MAX_REDIRECTS) {
                throw new Error('Too many redirects.');
            }
            const next = new URL(location, url);
            if (next.origin !== url.origin) {
                // As `fetch` does: a login is not carried to another site.
                headers = { ...headers };
                delete headers['authorization'];
            }
            url = next;
        }
    };
}
