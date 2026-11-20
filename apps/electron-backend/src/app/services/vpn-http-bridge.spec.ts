import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { socksConnect, VpnHttpBridge } from './vpn-http-bridge';
import { fakeSocks } from './vpn-socks.test-helpers';

/**
 * Sends raw bytes to the bridge and collects what comes back until the
 * connection closes, or until `complete` says the answer is all there (a
 * real client then closes its side).
 */
function exchange(
    port: number,
    request: string,
    afterConnect?: string,
    complete?: (answer: string) => boolean
): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1');
        let answer = '';
        let sentSecond = false;
        socket.on('data', (chunk) => {
            answer += chunk.toString('latin1');
            if (afterConnect && !sentSecond && answer.includes('\r\n\r\n')) {
                sentSecond = true;
                socket.write(afterConnect);
            }
            if (complete?.(answer)) socket.end();
        });
        socket.on('close', () => resolve(answer));
        socket.on('error', reject);
        socket.write(request);
    });
}

describe('VpnHttpBridge', () => {
    let origin: HttpServer;
    let originPort = 0;
    let seen: { url?: string; headers: Record<string, unknown> }[] = [];
    let raw: Server;
    let rawPort = 0;
    const closers: (() => Promise<void>)[] = [];

    beforeAll(async () => {
        origin = createHttpServer((request, response) => {
            seen.push({ url: request.url, headers: request.headers });
            if (request.url === '/keeps-open') {
                // A server that would keep the connection for more requests.
                response.writeHead(200, { 'Content-Length': '2', Connection: 'keep-alive' });
                response.end('ok');
                return;
            }
            let body = '';
            request.on('data', (chunk) => (body += chunk));
            request.on('end', () => response.end(`origin ${request.method} ${request.url} ${body}`));
        });
        await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
        originPort = (origin.address() as AddressInfo).port;
        // Stands in for anything that is not HTTP (TLS, for one).
        raw = createServer((socket) => {
            socket.on('error', () => socket.destroy());
            socket.on('data', (chunk) => socket.end(`echo:${chunk.toString()}`));
        });
        await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
        rawPort = (raw.address() as AddressInfo).port;
    });
    beforeEach(() => {
        seen = [];
    });
    afterEach(async () => {
        await Promise.all(closers.splice(0).map((close) => close()));
    });
    afterAll(async () => {
        origin.closeAllConnections();
        await new Promise((resolve) => origin.close(resolve));
        await new Promise((resolve) => raw.close(resolve));
    });

    async function setup(route = (_host: string, port: number): { host: string; port: number } | null => ({ host: '127.0.0.1', port })) {
        const socks = fakeSocks(route);
        const socksPort = await socks.listen();
        let tunnel: { host: string; port: number } | null = { host: '127.0.0.1', port: socksPort };
        const bridge = new VpnHttpBridge(() => tunnel);
        const port = await bridge.start();
        closers.push(() => bridge.stop(), () => socks.close());
        return { socks, bridge, port, down: () => (tunnel = null) };
    }

    it('forwards a plain HTTP request in origin form through the tunnel, the name unresolved', async () => {
        const { socks, port } = await setup();
        const answer = await exchange(
            port,
            `POST http://streams.example:${originPort}/live/1.ts?token=a HTTP/1.1\r\n` +
                `Host: streams.example:${originPort}\r\nUser-Agent: mpv\r\nProxy-Connection: keep-alive\r\n` +
                'Content-Length: 5\r\n\r\nhello'
        );
        expect(answer).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
        expect(answer).toContain('Connection: close');
        expect(answer.endsWith('origin POST /live/1.ts?token=a hello')).toBe(true);
        expect(socks.asked).toEqual([`streams.example:${originPort}`]);
        expect(seen[0].headers['user-agent']).toBe('mpv');
        expect(seen[0].headers.connection).toBe('close');
        expect(seen[0].headers['proxy-connection']).toBeUndefined();
    });

    it('tells the client to close even when the origin would keep the connection', async () => {
        const { port } = await setup();
        const answer = await exchange(
            port,
            `GET http://127.0.0.1:${originPort}/keeps-open HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\n\r\n`,
            undefined,
            (text) => text.endsWith('\r\n\r\nok')
        );
        expect(answer).toContain('Connection: close');
        expect(answer).not.toMatch(/keep-alive/i);
        expect(answer.endsWith('ok')).toBe(true);
    });

    it('tunnels CONNECT for everything that is not plain HTTP', async () => {
        const { socks, port } = await setup();
        const answer = await exchange(port, `CONNECT 127.0.0.1:${rawPort} HTTP/1.1\r\nHost: x\r\n\r\n`, 'ping');
        expect(answer).toBe('HTTP/1.1 200 Connection Established\r\n\r\necho:ping');
        expect(socks.asked).toEqual([`127.0.0.1:${rawPort}`]);
    });

    it('answers 502 and never connects directly when the tunnel refuses or is gone', async () => {
        const refused = await setup(() => null);
        const request = `GET http://127.0.0.1:${originPort}/ HTTP/1.1\r\nHost: x\r\n\r\n`;
        expect(await exchange(refused.port, request)).toMatch(/^HTTP\/1\.1 502 /);
        const gone = await setup();
        gone.down();
        expect(await exchange(gone.port, request)).toMatch(/^HTTP\/1\.1 502 /);
        expect(await exchange(gone.port, `CONNECT 127.0.0.1:${rawPort} HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1\.1 502 /);
        expect(seen).toEqual([]);
    });

    it('refuses what is not a proxy request', async () => {
        const { port } = await setup();
        expect(await exchange(port, 'GET /local/path HTTP/1.1\r\nHost: x\r\n\r\n')).toMatch(/^HTTP\/1\.1 400 /);
        expect(await exchange(port, 'GET https://example.org/ HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 400 /);
        expect(await exchange(port, 'nonsense\r\n\r\n')).toMatch(/^HTTP\/1\.1 400 /);
    });

    it('hands addresses to the tunnel as addresses', async () => {
        const socks = fakeSocks(() => null);
        const port = await socks.listen();
        closers.push(() => socks.close());
        for (const host of ['192.0.2.9', '2001:db8::1:2']) {
            await expect(socksConnect({ host: '127.0.0.1', port }, host, 80)).rejects.toThrow(/refused/);
        }
        expect(socks.asked).toEqual(['192.0.2.9:80', 'v6:20010db8000000000000000000010002:80']);
    });
});
