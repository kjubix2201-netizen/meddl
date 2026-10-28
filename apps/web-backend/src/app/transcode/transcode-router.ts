import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import express, { type Express, type RequestHandler } from 'express';
import {
    type ProviderUrlPolicy,
    validateProviderUrl,
} from '../provider-url-policy';
import { parseProbe, probeArgs, transcodeArgs, type ProbeResult } from './transcode-args';
import { createFfmpegTools } from './ffmpeg-provision';

/**
 * "Sound for every device": browsers drop Dolby Digital (AC-3/E-AC-3) and
 * DTS audio, so such streams play silently. The TV app can replay them
 * through this route, which runs FFmpeg on the meddl server: the picture is
 * copied, the sound becomes AAC.
 *
 * 1. `POST /transcode/session` (guarded like every proxy route) checks the
 *    stream URL against the provider URL policy and returns an unguessable
 *    id plus, when ffprobe is present, the duration.
 * 2. `GET /transcode/stream/:id?start=<s>` is what a <video> element opens.
 *    It cannot send an Authorization header, so the random id is the
 *    capability; ids expire after six idle hours.
 *
 * FFmpeg is found or, on Windows, downloaded once (ffmpeg-provision.ts).
 * Stream URLs carry provider credentials and are never logged.
 */
export interface TranscodeOptions {
    corsMiddleware: RequestHandler;
    providerUrlPolicy: ProviderUrlPolicy;
    spawn?: typeof nodeSpawn;
    tools?: ReturnType<typeof createFfmpegTools>;
    now?: () => number;
    /** Simultaneous conversions; the oldest stops when a new one starts. */
    maxProcesses?: number;
}

interface Session {
    url: string;
    userAgent?: string;
    duration?: number;
    touched: number;
    process?: ChildProcess;
}

const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15000;
export const TRANSCODE_STREAM_PREFIX = '/transcode/stream/';

export function mountTranscode(app: Express, options: TranscodeOptions): void {
    const spawn = options.spawn ?? nodeSpawn;
    const tools = options.tools ?? createFfmpegTools({ spawn });
    const now = options.now ?? Date.now;
    const maxProcesses = options.maxProcesses ?? 3;
    const sessions = new Map<string, Session>();
    const running: Session[] = [];

    function run(command: string, args: string[], timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            let child: ChildProcess;
            try {
                child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
            } catch (error) {
                reject(error);
                return;
            }
            const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
            child.stdout?.on('data', (chunk: Buffer) => {
                if (output.length < 1_000_000) output += chunk.toString();
            });
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve(output);
                else reject(new Error(`exit ${code}`));
            });
        });
    }
    async function probe(ffprobe: string, url: string, userAgent?: string): Promise<ProbeResult> {
        try {
            return parseProbe(await run(ffprobe, probeArgs(url, userAgent), PROBE_TIMEOUT_MS));
        } catch {
            return {};
        }
    }
    function sweep() {
        const limit = now() - SESSION_IDLE_MS;
        for (const [id, session] of sessions)
            if (session.touched < limit && !session.process) sessions.delete(id);
    }
    function stopProcess(session: Session) {
        session.process?.kill('SIGKILL');
        session.process = undefined;
        const index = running.indexOf(session);
        if (index >= 0) running.splice(index, 1);
    }

    app.options('/transcode/status', options.corsMiddleware);
    app.get('/transcode/status', options.corsMiddleware, async (_req, res) => {
        const ready = !!(await tools.ready());
        res.json({ available: ready, setup: tools.state() });
    });

    app.options('/transcode/session', options.corsMiddleware);
    app.post(
        '/transcode/session',
        options.corsMiddleware,
        express.json({ limit: '16kb' }),
        async (req, res) => {
            const body = (req.body ?? {}) as { url?: unknown; userAgent?: unknown };
            const rawUrl = typeof body.url === 'string' ? body.url : '';
            const userAgent =
                typeof body.userAgent === 'string' && body.userAgent.length < 300
                    ? body.userAgent
                    : undefined;
            const paths = await tools.ready();
            if (!paths) {
                const setup = tools.state();
                // Windows fetches FFmpeg once in the background: ask again.
                const preparing = setup.phase === 'downloading' || process.platform === 'win32';
                res.status(503).json({
                    message: preparing
                        ? 'The meddl server is setting up the sound conversion.'
                        : 'FFmpeg is not installed on the meddl server.',
                    code: preparing ? 'ffmpeg-preparing' : 'ffmpeg-missing',
                    setup,
                });
                return;
            }
            const target = await validateProviderUrl(rawUrl, options.providerUrlPolicy);
            if ('status' in target) {
                res.status(target.status).json({ message: target.message });
                return;
            }
            sweep();
            const url = target.url.href;
            const info = await probe(paths.ffprobe, url, userAgent);
            const id = randomBytes(18).toString('base64url');
            sessions.set(id, { url, userAgent, duration: info.duration, touched: now() });
            res.json({
                id,
                path: `${TRANSCODE_STREAM_PREFIX}${id}`,
                ...(info.duration ? { duration: info.duration } : {}),
                ...(info.audio ? { audio: info.audio } : {}),
            });
        }
    );

    app.get(`${TRANSCODE_STREAM_PREFIX}:id`, options.corsMiddleware, (req, res) => {
        const session = sessions.get(req.params['id'] ?? '');
        if (!session) {
            res.status(404).json({ message: 'Unknown or expired conversion.' });
            return;
        }
        session.touched = now();
        void streamSession(session, req, res);
    });

    async function streamSession(session: Session, req: express.Request, res: express.Response) {
        const paths = await tools.ready();
        if (!paths) {
            res.status(503).json({ message: 'FFmpeg is not available.' });
            return;
        }
        const ffmpeg = paths.ffmpeg;
        const start = Math.max(0, Number(req.query['start']) || 0);
        // A seek opens a new request for the same session: end the old one.
        stopProcess(session);
        while (running.length >= maxProcesses) stopProcess(running[0]);
        let child: ChildProcess;
        try {
            child = spawn(
                ffmpeg,
                transcodeArgs({ url: session.url, start, userAgent: session.userAgent }),
                { stdio: ['ignore', 'pipe', 'ignore'] }
            );
        } catch {
            res.status(503).json({ message: 'FFmpeg could not be started.' });
            return;
        }
        session.process = child;
        running.push(session);
        res.status(200);
        res.set({
            'Content-Type': 'video/mp4',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        child.stdout?.pipe(res);
        const finish = () => {
            if (session.process === child) stopProcess(session);
            else child.kill('SIGKILL');
        };
        child.on('error', () => {
            if (!res.headersSent) res.status(503).end();
            else res.end();
            finish();
        });
        child.on('close', () => {
            if (session.process === child) {
                session.process = undefined;
                const index = running.indexOf(session);
                if (index >= 0) running.splice(index, 1);
            }
            res.end();
        });
        // The viewer left, seeked or closed the player.
        req.on('close', finish);
    }
}
