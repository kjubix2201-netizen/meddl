import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { allowedTarget, handleHomeNetworkRequest, homeNetworkAddresses } from './home-network-server';

describe('home network server', () => {
    let root: string;
    let server: Server;
    let base: string;

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'meddl-home-'));
        mkdirSync(join(root, 'assets'));
        writeFileSync(join(root, 'index.html'), '<html><head><title>meddl</title></head></html>');
        writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
        server = createServer(handleHomeNetworkRequest(root));
        await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((done) => server.close(() => done())));

    it('serves the interface and marks it for the direct line', async () => {
        const page = await (await fetch(`${base}/`)).text();
        expect(page).toContain('window.meddlServed={directFetch:true}');
        const script = await fetch(`${base}/assets/app.js`);
        expect(script.headers.get('content-type')).toContain('text/javascript');
    });

    it('never serves files outside the interface folder', async () => {
        const response = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
        expect(await response.text()).not.toContain('root:');
    });

    it('refuses direct-line requests to this computer', async () => {
        const response = await fetch(`${base}/__meddl/fetch?u=${encodeURIComponent('http://127.0.0.1:3333/')}`);
        expect(response.status).toBe(400);
        expect(response.headers.get('x-meddl-fetch-error')).toBeTruthy();
    });

    it('allows provider addresses only', () => {
        expect(allowedTarget('http://panel.example:8080/player_api.php')).toBe(true);
        expect(allowedTarget('http://192.168.1.20:9981/playlist')).toBe(true);
        for (const blocked of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/', 'file:///etc/passwd', 'nonsense'])
            expect(allowedTarget(blocked)).toBe(false);
    });

    it('lists home network addresses, 192.168 first', () => {
        expect(
            homeNetworkAddresses({
                a: [{ address: '172.20.0.1', family: 'IPv4', internal: false } as never],
                b: [{ address: '192.168.178.20', family: 'IPv4', internal: false } as never],
                c: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
            })
        ).toEqual(['192.168.178.20', '172.20.0.1']);
    });
});
