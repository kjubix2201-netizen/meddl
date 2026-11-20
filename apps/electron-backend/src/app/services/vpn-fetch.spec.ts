import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { createTunnelFetch } from './vpn-fetch';
import { fakeSocks, toLocalhost } from './vpn-socks.test-helpers';

describe('createTunnelFetch', () => {
    let origin: Server;
    let port = 0;
    let seen: { url?: string; headers: Record<string, unknown> }[] = [];
    const closers: (() => Promise<void>)[] = [];

    beforeAll(async () => {
        origin = createServer((request, response) => {
            seen.push({ url: request.url, headers: request.headers });
            if (request.url === '/moved') {
                response.writeHead(302, { Location: '/list?page=2' });
                response.end();
            } else if (request.url === '/elsewhere') {
                response.writeHead(307, { Location: `http://other.example:${port}/list` });
                response.end();
            } else if (request.url === '/loop') {
                response.writeHead(301, { Location: '/loop' });
                response.end();
            } else if (request.url === '/packed') {
                response.writeHead(200, { 'Content-Encoding': 'gzip' });
                response.end(gzipSync(String.fromCharCode(0xfeff) + '{"titles":["Größe"]}'));
            } else if (request.url === '/slow') {
                // Never answers.
            } else {
                response.writeHead(request.url === '/missing' ? 404 : 200);
                response.end(`answer for ${request.url}`);
            }
        });
        await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
        port = (origin.address() as AddressInfo).port;
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
    });

    async function tunnel() {
        const socks = fakeSocks(toLocalhost);
        const socksPort = await socks.listen();
        closers.push(() => socks.close());
        let address: { host: string; port: number } | null = { host: '127.0.0.1', port: socksPort };
        return { socks, fetch: createTunnelFetch(() => address), down: () => (address = null) };
    }

    it('gets status and text through the tunnel, the name left to the tunnel', async () => {
        const { socks, fetch } = await tunnel();
        const response = await fetch(`http://panel.example:${port}/player_api.php?action=x`, {
            headers: { 'User-Agent': 'VLC/3.0.20', Cookie: 'mac=00:1A' },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('answer for /player_api.php?action=x');
        expect(socks.asked).toEqual([`panel.example:${port}`]);
        expect(seen[0].headers).toMatchObject({
            host: `panel.example:${port}`,
            'user-agent': 'VLC/3.0.20',
            cookie: 'mac=00:1A',
        });
        const missing = await fetch(`http://panel.example:${port}/missing`);
        expect(missing.status).toBe(404);
    });

    it('follows redirects, each hop through the tunnel, and drops a login on another site', async () => {
        const { socks, fetch } = await tunnel();
        const moved = await fetch(`http://panel.example:${port}/moved`, { headers: { Authorization: 'Basic x' } });
        expect(await moved.text()).toBe('answer for /list?page=2');
        expect(seen[1].headers.authorization).toBe('Basic x');
        const elsewhere = await fetch(`http://panel.example:${port}/elsewhere`, { headers: { Authorization: 'Basic x' } });
        expect(await elsewhere.text()).toBe('answer for /list');
        expect(seen[3].headers.authorization).toBeUndefined();
        expect(socks.asked.at(-1)).toBe(`other.example:${port}`);
        await expect(fetch(`http://panel.example:${port}/loop`)).rejects.toThrow('Too many redirects');
    });

    it('unpacks a compressed answer and drops a byte-order mark', async () => {
        const { fetch } = await tunnel();
        const response = await fetch(`http://panel.example:${port}/packed`);
        expect(await response.text()).toBe('{"titles":["Größe"]}');
        expect(seen[0].headers['accept-encoding']).toContain('gzip');
    });

    it('fails instead of connecting directly when the tunnel is down, and honours the time limit', async () => {
        const { fetch, down } = await tunnel();
        await expect(
            fetch(`http://panel.example:${port}/slow`, { signal: AbortSignal.timeout(150) })
        ).rejects.toThrow();
        down();
        await expect(fetch(`http://127.0.0.1:${port}/list`)).rejects.toThrow('The VPN is not connected');
        await expect(fetch('ftp://panel.example/list')).rejects.toThrow('Only http and https');
        expect(seen.map((request) => request.url)).toEqual(['/slow']);
    });
});
