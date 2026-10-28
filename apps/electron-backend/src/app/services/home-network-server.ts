/**
 * Shares meddl in the home network: phones and tablets (the iPhone home
 * screen app above all) open http://<this computer>:3340 and get the TV
 * interface, served by the desktop app together with the same direct line
 * the Android TV app offers (`/__meddl/fetch`, see libs/tv/data-access
 * direct-fetch.ts). Off until the viewer turns it on in Settings.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { tvDirectFetch } from '../events/tv-direct-fetch.events';

export const HOME_NETWORK_PORT = 3340;

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
};

/** Marks pages served here, so the TV interface uses the direct line. */
const SERVED_MARK = '<script>window.meddlServed={directFetch:true}</script>';

export interface HomeNetworkStatus {
    enabled: boolean;
    port: number;
    addresses: string[];
    error?: string;
}

/** This computer's IPv4 addresses in the home network, 192.168.x first. */
export function homeNetworkAddresses(
    interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
    const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
    const rank = (a: string) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2);
    return Object.values(interfaces)
        .flat()
        .filter((entry) => !!entry && entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry!.address)
        .filter((address) => privateRange.test(address))
        .sort((a, b) => rank(a) - rank(b));
}

/**
 * Provider addresses only: the direct line must not reach this computer
 * itself (loopback) or link-local services for other devices in the home.
 */
export function allowedTarget(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return !(
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host === '0.0.0.0' ||
        host === '::' ||
        host === '::1' ||
        /^127\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^fe80:/.test(host) ||
        /^::ffff:127\./.test(host)
    );
}

/** The packaged TV interface, or the build output while developing. */
export function tvInterfaceDirectory(): string {
    const packaged = resolve(__dirname, '..', 'tv');
    return existsSync(resolve(packaged, 'index.html')) ? packaged : resolve(process.cwd(), 'dist/apps/tv');
}

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
}

async function directLine(req: IncomingMessage, res: ServerResponse, url: URL) {
    const target = url.searchParams.get('u') ?? '';
    if (!allowedTarget(target)) {
        send(res, 400, '', { 'X-Meddl-Fetch-Error': 'address not allowed' });
        return;
    }
    let headers: Record<string, string> = {};
    try {
        const parsed = JSON.parse(url.searchParams.get('h') || '{}');
        if (parsed && typeof parsed === 'object') headers = parsed;
    } catch {
        // No extra headers.
    }
    try {
        const response = await tvDirectFetch({ url: target, headers, timeoutMs: Number(url.searchParams.get('t')) });
        send(res, response.status, response.body, { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch (error) {
        const reason = error instanceof Error ? error.name || 'failed' : 'failed';
        send(res, 502, '', { 'X-Meddl-Fetch-Error': reason.replace(/[^\w .-]/g, '') || 'failed' });
    }
    void req;
}

function staticFile(res: ServerResponse, root: string, pathname: string) {
    let path: string;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        return send(res, 400, 'Bad request');
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) return send(res, 404, 'Not found');
    const target = existsSync(file) && statSync(file).isFile() ? file : resolve(root, 'index.html');
    if (!existsSync(target)) return send(res, 404, 'meddl interface not found');
    const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    if (target.endsWith('index.html')) {
        const html = readFileSync(target, 'utf8').replace('<head>', `<head>${SERVED_MARK}`);
        return send(res, 200, html, { 'Content-Type': type });
    }
    return send(res, 200, readFileSync(target), {
        'Content-Type': type,
        'Cache-Control': /\/assets\//.test(target.replace(/\\/g, '/')) ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
    });
}

export function handleHomeNetworkRequest(root: string) {
    return (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '');
        const url = new URL(req.url ?? '/', 'http://meddl.home');
        if (url.pathname === '/__meddl/fetch') {
            void directLine(req, res, url);
            return;
        }
        staticFile(res, root, url.pathname);
    };
}

class HomeNetworkServer {
    private server: Server | null = null;
    private error: string | undefined;

    status(): HomeNetworkStatus {
        return {
            enabled: !!this.server,
            port: HOME_NETWORK_PORT,
            addresses: this.server ? homeNetworkAddresses() : [],
            ...(this.error ? { error: this.error } : {}),
        };
    }

    async start(): Promise<HomeNetworkStatus> {
        if (this.server) return this.status();
        this.error = undefined;
        const server = createServer(handleHomeNetworkRequest(tvInterfaceDirectory()));
        server.requestTimeout = 320_000;
        try {
            await new Promise<void>((done, fail) => {
                server.once('error', fail);
                server.listen(HOME_NETWORK_PORT, '0.0.0.0', () => {
                    server.off('error', fail);
                    done();
                });
            });
            this.server = server;
        } catch (error) {
            this.error =
                (error as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
                    ? `Port ${HOME_NETWORK_PORT} is already in use.`
                    : error instanceof Error
                      ? error.message
                      : String(error);
        }
        return this.status();
    }

    async stop(): Promise<HomeNetworkStatus> {
        const server = this.server;
        this.server = null;
        this.error = undefined;
        if (server)
            await new Promise<void>((done) => {
                server.close(() => done());
                server.closeAllConnections();
            });
        return this.status();
    }
}

export const homeNetworkServer = new HomeNetworkServer();
