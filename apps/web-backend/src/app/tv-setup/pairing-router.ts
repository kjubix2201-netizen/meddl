import express, {
    type Express,
    type RequestHandler,
    type ErrorRequestHandler,
} from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { createAccessGuard } from '../storage/access-guard';
import { PairingError, PairingStore } from './pairing-store';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

/**
 * This computer's addresses in the home network (IPv4, private ranges), so
 * a TV app connected through "localhost" can put a reachable address into
 * the phone setup QR code.
 */
export function homeNetworkAddresses(
    interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
    const privateRange = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
    return Object.values(interfaces)
        .flat()
        .filter((entry) => !!entry && entry.family === 'IPv4' && !entry.internal)
        .map((entry) => entry!.address)
        .filter((address) => privateRange.test(address))
        // Home routers use 192.168.x; 172.x is mostly WSL / Hyper-V / Docker.
        .sort((a, b) => rank(a) - rank(b));
}
const rank = (address: string) =>
    address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : 2;
/** Separate capabilities authorize phone traffic; existing server auth still guards TV creation. */
export function mountTvSetup(
    app: Express,
    cors: RequestHandler,
    accessToken: string | null
) {
    const router = express.Router();
    const store = new PairingStore();
    const bundled = resolve(__dirname, 'tv-setup');
    const assets = existsSync(resolve(bundled, 'index.html'))
        ? bundled
        : resolve(process.cwd(), 'dist/apps/tv-setup');
    const guard: RequestHandler = accessToken
        ? createAccessGuard(accessToken)
        : (_req, _res, next) => next();
    router.use((_req, res, next) => {
        res.set({
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        });
        next();
    });
    router.get('/connection', (_req, res) =>
        res.set('Access-Control-Allow-Origin', '*').json({
            service: 'meddl',
            protocol: 1,
            pairing: true,
            auth: accessToken ? 'token' : 'none',
            addresses: homeNetworkAddresses(),
        })
    );
    router.options('/connection/check', cors);
    router.get('/connection/check', cors, guard, (_req, res) =>
        res.json({ service: 'meddl', connected: true })
    );
    const setupAssetsLimit = rateLimit({
        windowMs: 60_000,
        limit: 60,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // Do not trust client-supplied forwarding headers. Proxy peers share a budget.
        keyGenerator: (req) =>
            ipKeyGenerator(req.socket.remoteAddress ?? 'unknown'),
        message: { message: 'Too many setup requests. Try again shortly.' },
    });
    router.get('/setup', setupAssetsLimit, (_req, res) =>
        res.sendFile(resolve(assets, 'index.html'), { dotfiles: 'allow' })
    );
    router.get('/setup.css', setupAssetsLimit, (_req, res) =>
        res.sendFile(resolve(assets, 'setup.css'), { dotfiles: 'allow' })
    );
    router.get('/setup.js', setupAssetsLimit, (_req, res) =>
        res.sendFile(resolve(assets, 'setup.js'), { dotfiles: 'allow' })
    );
    router.options('/pairing', cors);
    router.post(
        '/pairing',
        cors,
        guard,
        express.json({ limit: '16kb' }),
        (_req, res) =>
            res
                .status(201)
                .json(
                    store.create(
                        _req.ip ?? 'unknown',
                        _req.body?.purpose ?? 'source',
                        _req.body?.defaults
                    )
                )
    );
    router.use('/pairing', express.json({ limit: '16kb' }));
    router.options('/pairing/:id/tv', cors);
    router.get('/pairing/:id/tv', cors, (req, res) =>
        res.json(
            store.read(
                String(req.params.id),
                req.get('X-TV-Pairing') ?? '',
                'tv'
            )
        )
    );
    router.post('/pairing/:id/tv', cors, (req, res) =>
        res.json(
            store.finish(
                String(req.params.id),
                req.get('X-TV-Pairing') ?? '',
                req.body?.outcome
            )
        )
    );
    router.get('/pairing/:id/phone', (req, res) =>
        res.json(
            store.read(
                String(req.params.id),
                req.get('X-TV-Pairing') ?? '',
                'phone'
            )
        )
    );
    router.post('/pairing/:id/phone', (req, res) =>
        res.json(
            store.submit(
                String(req.params.id),
                req.get('X-TV-Pairing') ?? '',
                req.body
            )
        )
    );
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
        const status = error instanceof PairingError ? error.status : 400;
        res.status(status).json({
            message:
                error instanceof PairingError
                    ? error.message
                    : 'Invalid setup request.',
        });
    };
    router.use(errors);
    app.use('/tv', router);
    return store;
}
