/**
 * Phone setup by QR code in the desktop app, without a meddl server: a small
 * web server in the home network that shows the phone form (the
 * apps/tv-setup page) and relays what the phone enters to the TV interface.
 * Same routes and rules as the web backend's tv-setup and the Android TV
 * app's PairingServer.kt: sessions live in memory for five minutes, the
 * phone only gets its own token, and only this computer (loopback) may open
 * or read a session. The TV interface checks the entries before saving.
 * Started on demand when the viewer opens "Add from phone".
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homeNetworkAddresses } from './home-network-server';

const PORTS = [3341, 3342, 3343, 3344, 3345];
const TTL_MS = 5 * 60_000;
const MAX_BODY = 16 * 1024;
const MAX_SESSIONS = 32;

type Status = 'waiting' | 'pending' | 'saved' | 'rejected' | 'cancelled';
interface Session {
    id: string;
    tvToken: string;
    phoneToken: string;
    expiresAt: number;
    purpose: 'source' | 'settings';
    defaults?: unknown;
    status: Status;
    entry?: unknown;
}

class Failure extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

const ASSETS: Record<string, [string, string]> = {
    '/tv/setup': ['index.html', 'text/html; charset=utf-8'],
    '/tv/setup.css': ['setup.css', 'text/css; charset=utf-8'],
    '/tv/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
};

/** The packaged phone page, or the build output while developing. */
export function setupPageDirectory(): string {
    const packaged = resolve(__dirname, '..', 'tv-setup');
    return existsSync(resolve(packaged, 'index.html')) ? packaged : resolve(process.cwd(), 'dist/apps/tv-setup');
}

export class PairingStore {
    private sessions = new Map<string, Session>();

    constructor(private readonly now = Date.now) {}

    create(request: { purpose?: unknown; defaults?: unknown }) {
        this.sweep();
        const purpose = request.purpose === undefined || request.purpose === '' ? 'source' : request.purpose;
        if (purpose !== 'source' && purpose !== 'settings') throw new Failure(400, 'Invalid setup purpose.');
        if (this.sessions.size >= MAX_SESSIONS) throw new Failure(429, 'Too many setup attempts. Try again shortly.');
        const token = () => randomBytes(24).toString('base64url');
        const session: Session = {
            id: token(),
            tvToken: token(),
            phoneToken: token(),
            expiresAt: this.now() + TTL_MS,
            purpose,
            defaults: purpose === 'settings' ? request.defaults : undefined,
            status: 'waiting',
        };
        this.sessions.set(session.id, session);
        const { id, tvToken, phoneToken, expiresAt } = session;
        return { id, tvToken, phoneToken, expiresAt };
    }

    read(id: string, token: string, tv: boolean) {
        const s = this.authorize(id, token, tv);
        return {
            status: s.status,
            purpose: s.purpose,
            expiresAt: s.expiresAt,
            ...(s.defaults !== undefined ? { defaults: s.defaults } : {}),
            ...(tv && s.entry !== undefined ? { [s.purpose === 'settings' ? 'settings' : 'source']: s.entry } : {}),
        };
    }

    submit(id: string, token: string, entry: unknown) {
        const s = this.authorize(id, token, false);
        if (s.status !== 'waiting') throw new Failure(409, 'This link has already been used.');
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Failure(400, 'Invalid source.');
        s.entry = entry;
        s.status = 'pending';
        return { status: s.status };
    }

    finish(id: string, token: string, outcome: unknown) {
        const s = this.authorize(id, token, true);
        if (outcome !== 'saved' && outcome !== 'rejected' && outcome !== 'cancelled') throw new Failure(400, 'Invalid result.');
        if (s.status === outcome) return { status: s.status };
        if ((outcome !== 'cancelled' && s.status !== 'pending') || ['saved', 'rejected', 'cancelled'].includes(s.status))
            throw new Failure(409, 'This setup session is already closed.');
        s.status = outcome;
        delete s.entry;
        return { status: s.status };
    }

    clear() {
        this.sessions.clear();
    }

    private authorize(id: string, token: string, tv: boolean): Session {
        this.sweep();
        const s = this.sessions.get(id);
        if (!s) throw new Failure(410, 'This setup link expired. Open a new QR code on the TV.');
        const expected = Buffer.from(tv ? s.tvToken : s.phoneToken);
        const supplied = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new Failure(403, 'This setup link is not valid.');
        return s;
    }

    private sweep() {
        const now = this.now();
        for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
    }
}

function loopback(req: IncomingMessage): boolean {
    const address = req.socket.remoteAddress ?? '';
    return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');
}

function json(res: ServerResponse, status: number, body: unknown, req: IncomingMessage) {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // The desktop TV interface (file:// page) calls through CORS.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-TV-Pairing, Authorization',
        'Access-Control-Max-Age': '600',
    };
    if (req.headers['access-control-request-private-network'] === 'true')
        headers['Access-Control-Allow-Private-Network'] = 'true';
    res.writeHead(status, headers);
    res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((done, fail) => {
        let size = 0;
        const parts: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                fail(new Failure(413, 'Too large.'));
                req.destroy();
                return;
            }
            parts.push(chunk);
        });
        req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
        req.on('error', fail);
    });
}

function parse(body: string): Record<string, unknown> {
    if (!body.trim()) return {};
    try {
        const value = JSON.parse(body);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
        // Falls through to the error below.
    }
    throw new Failure(400, 'Invalid setup request.');
}

export function handlePairingRequest(store: PairingStore, root: string) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://meddl.setup');
        const path = url.pathname;
        const method = req.method ?? 'GET';
        if (method === 'OPTIONS') return json(res, 204, undefined, req);
        try {
            if (path === '/tv/connection' && method === 'GET')
                return json(
                    res,
                    200,
                    { service: 'meddl', protocol: 1, pairing: true, auth: 'none', addresses: homeNetworkAddresses() },
                    req
                );
            const asset = ASSETS[path];
            if (asset && method === 'GET') {
                const file = resolve(root, asset[0]);
                if (!existsSync(file)) throw new Failure(404, 'Not found.');
                res.writeHead(200, {
                    'Content-Type': asset[1],
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Referrer-Policy': 'no-referrer',
                    'Content-Security-Policy':
                        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
                });
                res.end(readFileSync(file));
                return;
            }
            if (path === '/tv/pairing' && method === 'POST') {
                if (!loopback(req)) throw new Failure(403, 'Only the TV can start a setup.');
                const body = parse(await readBody(req));
                return json(res, 201, store.create(body), req);
            }
            const match = /^\/tv\/pairing\/([^/]+)\/(tv|phone)$/.exec(path);
            if (match) {
                const id = decodeURIComponent(match[1]);
                const role = match[2];
                const token = String(req.headers['x-tv-pairing'] ?? '');
                if (role === 'tv' && !loopback(req)) throw new Failure(403, 'This setup link is not valid.');
                if (method === 'GET') return json(res, 200, store.read(id, token, role === 'tv'), req);
                if (method === 'POST') {
                    const body = parse(await readBody(req));
                    return json(
                        res,
                        200,
                        role === 'tv' ? store.finish(id, token, body.outcome) : store.submit(id, token, body),
                        req
                    );
                }
            }
            throw new Failure(404, 'Not found.');
        } catch (error) {
            const status = error instanceof Failure ? error.status : 400;
            const message = error instanceof Failure ? error.message : 'Invalid setup request.';
            return json(res, status, { message }, req);
        }
    };
}

class PairingServer {
    private server: Server | null = null;
    private port = 0;
    private readonly store = new PairingStore();

    /** Starts once; the address for the TV interface, or "" if no port could be opened. */
    async start(): Promise<string> {
        if (this.server) return `http://127.0.0.1:${this.port}`;
        for (const port of PORTS) {
            const server = createServer((req, res) => void handlePairingRequest(this.store, setupPageDirectory())(req, res));
            server.requestTimeout = 15_000;
            const opened = await new Promise<boolean>((done) => {
                server.once('error', () => done(false));
                server.listen(port, '0.0.0.0', () => done(true));
            });
            if (opened) {
                this.server = server;
                this.port = port;
                return `http://127.0.0.1:${port}`;
            }
        }
        return '';
    }

    async stop() {
        const server = this.server;
        this.server = null;
        this.store.clear();
        if (server) await new Promise<void>((done) => server.close(() => done()));
    }
}

export const pairingServer = new PairingServer();
