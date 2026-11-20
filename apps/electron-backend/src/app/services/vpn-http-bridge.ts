import {
    connect,
    createServer,
    isIP,
    type Server,
    type Socket,
} from 'node:net';

/**
 * An HTTP proxy on this machine that sends everything on through a SOCKS5
 * proxy (the built-in VPN's tunnel). The tunnel itself only speaks SOCKS5;
 * the page (Chromium), the main process and above all the MPV player
 * (ffmpeg has no SOCKS support, and most IPTV streams are plain HTTP) speak
 * HTTP-proxy. One path for all three, so nothing has to be kept in step.
 *
 * - `CONNECT host:port` becomes a tunnel (HTTPS and anything else on TCP).
 * - `GET http://host/path` (any method) is forwarded in origin form, one
 *   request per connection (both sides are told to close afterwards).
 * - Host names travel to the SOCKS5 side unresolved: the VPN's DNS answers,
 *   never this machine's.
 * - When the tunnel is gone the answer is 502. Nothing ever falls back to a
 *   direct connection: a request either goes through the VPN or fails.
 */

const HEAD_LIMIT = 64 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;

export interface SocksAddress {
    host: string;
    port: number;
}

/** Reads exactly `length` bytes from a socket that is not flowing yet. */
function readExactly(socket: Socket, length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const tryRead = () => {
            const chunk = socket.read(length) as Buffer | null;
            if (chunk === null) {
                return;
            }
            cleanup();
            resolve(chunk);
        };
        const fail = () => {
            cleanup();
            reject(new Error('The SOCKS5 proxy closed the connection.'));
        };
        const cleanup = () => {
            socket.off('readable', tryRead);
            socket.off('error', fail);
            socket.off('close', fail);
        };
        socket.on('readable', tryRead);
        socket.on('error', fail);
        socket.on('close', fail);
        tryRead();
    });
}

/** An IPv6 address as its 16 bytes (`::`, and a dotted IPv4 tail, included). */
function ipv6Bytes(address: string): Buffer {
    const [head, tail] = address.split('::');
    const groups = (part: string | undefined) =>
        (part ? part.split(':') : []).flatMap((group) => {
            if (!group.includes('.')) {
                return [parseInt(group, 16)];
            }
            const [a, b, c, d] = group.split('.').map(Number);
            return [(a << 8) | b, (c << 8) | d];
        });
    const left = groups(head);
    const right = groups(tail);
    const words = [
        ...left,
        ...new Array<number>(Math.max(0, 8 - left.length - right.length)).fill(0),
        ...right,
    ];
    const bytes = Buffer.alloc(16);
    words.slice(0, 8).forEach((word, index) => bytes.writeUInt16BE(word, index * 2));
    return bytes;
}

/** The SOCKS5 address field: an address as its bytes, a name as a name. */
function socksTarget(host: string): Buffer {
    const family = isIP(host);
    if (family === 4) {
        return Buffer.from([0x01, ...host.split('.').map(Number)]);
    }
    if (family === 6) {
        return Buffer.concat([Buffer.from([0x04]), ipv6Bytes(host)]);
    }
    const name = Buffer.from(host, 'utf8');
    return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

/**
 * A TCP connection to `host:port` made by the SOCKS5 proxy (no login; a
 * host name is handed over as a name, so the proxy's side resolves it).
 * Resolves with the connected socket.
 */
export async function socksConnect(
    proxy: SocksAddress,
    host: string,
    port: number,
    timeoutMs = CONNECT_TIMEOUT_MS
): Promise<Socket> {
    const length = Buffer.byteLength(host, 'utf8');
    if (!length || length > 255 || !(port >= 1 && port <= 65535)) {
        throw new Error('Not a host and port the proxy can connect to.');
    }
    const socket = connect({ host: proxy.host, port: proxy.port });
    const timer = setTimeout(
        () => socket.destroy(new Error('The SOCKS5 proxy did not answer.')),
        timeoutMs
    );
    try {
        await new Promise<void>((resolve, reject) => {
            const failed = (error: Error) => reject(error);
            socket.once('error', failed);
            socket.once('connect', () => {
                socket.off('error', failed);
                resolve();
            });
        });
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
        const method = await readExactly(socket, 2);
        if (method[0] !== 0x05 || method[1] !== 0x00) {
            throw new Error('The SOCKS5 proxy wants a login.');
        }
        socket.write(
            Buffer.concat([
                Buffer.from([0x05, 0x01, 0x00]),
                socksTarget(host),
                Buffer.from([port >> 8, port & 0xff]),
            ])
        );
        const reply = await readExactly(socket, 4);
        if (reply[0] !== 0x05 || reply[1] !== 0x00) {
            throw new Error(`The SOCKS5 proxy refused (code ${reply[1]}).`);
        }
        // The bound address that follows is of no use here; skip it.
        const rest =
            reply[3] === 0x01
                ? 4
                : reply[3] === 0x04
                  ? 16
                  : reply[3] === 0x03
                    ? (await readExactly(socket, 1))[0]
                    : -1;
        if (rest < 0) {
            throw new Error('The SOCKS5 proxy sent an unknown reply.');
        }
        await readExactly(socket, rest + 2);
        return socket;
    } catch (error) {
        socket.destroy();
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

interface RequestHead {
    method: string;
    target: string;
    version: string;
    headers: string[];
}

function parseHead(text: string): RequestHead | null {
    const [first, ...headers] = text.split('\r\n');
    const match = first.match(/^([A-Z]+) (\S+) (HTTP\/1\.[01])$/);
    return match
        ? {
              method: match[1],
              target: match[2],
              version: match[3],
              headers: headers.filter(Boolean),
          }
        : null;
}

/** Where a request goes: `CONNECT host:port`, or an absolute http:// URL. */
function destination(
    head: RequestHead
): { host: string; port: number; path: string } | null {
    if (head.method === 'CONNECT') {
        const match = head.target.match(/^(\[[^\]]+\]|[^:]+):(\d+)$/);
        return match
            ? {
                  host: match[1].replace(/^\[|\]$/g, ''),
                  port: Number(match[2]),
                  path: '',
              }
            : null;
    }
    try {
        const url = new URL(head.target);
        if (url.protocol !== 'http:') {
            return null;
        }
        return {
            host: url.hostname.replace(/^\[|\]$/g, ''),
            port: Number(url.port) || 80,
            path: `${url.pathname}${url.search}`,
        };
    } catch {
        return null;
    }
}

const HOP_HEADERS = /^(proxy-connection|proxy-authorization|connection|keep-alive):/i;

export class VpnHttpBridge {
    private server: Server | null = null;
    private readonly sockets = new Set<Socket>();

    constructor(private readonly socks: () => SocksAddress | null) {}

    /** Starts listening on this machine only; resolves with the port. */
    start(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = createServer((client) => this.accept(client));
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    server.close();
                    reject(new Error('The VPN bridge has no port.'));
                    return;
                }
                this.server = server;
                resolve(address.port);
            });
        });
    }

    /** Ends every connection that runs through the bridge. */
    stop(): Promise<void> {
        const server = this.server;
        this.server = null;
        this.sockets.forEach((socket) => socket.destroy());
        this.sockets.clear();
        return new Promise((resolve) =>
            server ? server.close(() => resolve()) : resolve()
        );
    }

    /** Cuts what is in flight, e.g. when the tunnel drops; keeps listening. */
    dropConnections(): void {
        this.sockets.forEach((socket) => socket.destroy());
        this.sockets.clear();
    }

    private track(socket: Socket): void {
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
        // A peer that goes away mid-stream is everyday business here.
        socket.on('error', () => socket.destroy());
    }

    private accept(client: Socket): void {
        this.track(client);
        let received = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
            received = Buffer.concat([received, chunk]);
            const end = received.indexOf('\r\n\r\n');
            if (end < 0) {
                if (received.length > HEAD_LIMIT) {
                    this.refuse(client, 431, 'Request Header Fields Too Large');
                }
                return;
            }
            client.off('data', onData);
            client.pause();
            const head = parseHead(received.subarray(0, end).toString('latin1'));
            void this.forward(client, head, received.subarray(end + 4));
        };
        client.on('data', onData);
    }

    private refuse(client: Socket, status: number, reason: string): void {
        if (!client.destroyed) {
            client.end(
                `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
            );
        }
    }

    private async forward(
        client: Socket,
        head: RequestHead | null,
        body: Buffer
    ): Promise<void> {
        const target = head ? destination(head) : null;
        if (!head || !target) {
            this.refuse(client, 400, 'Bad Request');
            return;
        }
        const socks = this.socks();
        let upstream: Socket;
        try {
            if (!socks) {
                throw new Error('The VPN is not connected.');
            }
            upstream = await socksConnect(socks, target.host, target.port);
        } catch {
            this.refuse(client, 502, 'Bad Gateway');
            return;
        }
        if (client.destroyed) {
            upstream.destroy();
            return;
        }
        this.track(upstream);
        client.once('close', () => upstream.destroy());
        // What the origin already sent still has to reach the client.
        upstream.once('close', () => {
            if (!client.destroyed) {
                client.end();
            }
        });
        if (head.method === 'CONNECT') {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.pipe(client);
        } else {
            // One request per connection keeps this a plain relay: both
            // sides are told to close, so a client never sends a request
            // for another host down a connection that leads to this one.
            upstream.write(
                [
                    `${head.method} ${target.path || '/'} ${head.version}`,
                    ...head.headers.filter((line) => !HOP_HEADERS.test(line)),
                    'Connection: close',
                    '',
                    '',
                ].join('\r\n'),
                'latin1'
            );
            this.relayAnswer(upstream, client);
        }
        if (body.length) {
            upstream.write(body);
        }
        client.pipe(upstream);
        client.resume();
    }

    /** The origin's answer, with "this connection closes" in its head. */
    private relayAnswer(upstream: Socket, client: Socket): void {
        let received = Buffer.alloc(0);
        let passedOn = false;
        // An answer that ends before its head is complete goes out as it is.
        upstream.once('end', () => {
            if (!passedOn && received.length && !client.destroyed) {
                client.write(received);
            }
        });
        const onData = (chunk: Buffer) => {
            received = Buffer.concat([received, chunk]);
            const end = received.indexOf('\r\n\r\n');
            if (end < 0 && received.length <= HEAD_LIMIT) {
                return;
            }
            upstream.off('data', onData);
            passedOn = true;
            if (end < 0) {
                // No head in sight: not HTTP as we know it; pass it on as is.
                client.write(received);
            } else {
                const [status, ...headers] = received
                    .subarray(0, end)
                    .toString('latin1')
                    .split('\r\n');
                client.write(
                    [
                        status,
                        ...headers.filter((line) => !HOP_HEADERS.test(line)),
                        'Connection: close',
                        '',
                        '',
                    ].join('\r\n'),
                    'latin1'
                );
                client.write(received.subarray(end + 4));
            }
            upstream.pipe(client);
        };
        upstream.on('data', onData);
    }
}
