import { spawn as nodeSpawn } from 'node:child_process';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readZipEntry } from './zip-reader';

/**
 * Finds FFmpeg for the sound conversion, and on Windows fetches it once by
 * itself, so nobody has to install anything:
 *
 * 1. MEDDL_FFMPEG / MEDDL_FFPROBE, when set;
 * 2. a copy meddl downloaded before (<data dir>/ffmpeg/);
 * 3. `ffmpeg` / `ffprobe` on the PATH (Docker image, Linux packages);
 * 4. Windows only: download the LGPL build of FFmpeg-Builds (BtbN) into
 *    <data dir>/ffmpeg/ in the background, then use it.
 *
 * LGPL builds keep the bundled decoders/encoders free to redistribute with
 * a commercial app; they include the AAC encoder and the Dolby/DTS decoders.
 */
export type ToolPaths = { ffmpeg: string; ffprobe: string };
export type SetupState =
    | { phase: 'ready' }
    | { phase: 'downloading'; received: number; total: number }
    | { phase: 'unavailable'; reason: string };

const WINDOWS_BUILDS = [
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-lgpl-7.1.zip',
];

export function meddlDataDir(): string {
    const configured = process.env['MEDDL_DATA_DIR'];
    if (configured) return configured;
    if (process.platform === 'win32')
        return path.join(process.env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local'), 'meddl');
    return path.join(homedir(), '.local', 'share', 'meddl');
}

export interface FfmpegToolsOptions {
    spawn?: typeof nodeSpawn;
    dataDir?: string;
    platform?: NodeJS.Platform;
    fetch?: typeof fetch;
    env?: NodeJS.ProcessEnv;
}

export function createFfmpegTools(options: FfmpegToolsOptions = {}) {
    const spawn = options.spawn ?? nodeSpawn;
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const exe = platform === 'win32' ? '.exe' : '';
    const dir = path.join(options.dataDir ?? meddlDataDir(), 'ffmpeg');
    const downloaded: ToolPaths = {
        ffmpeg: path.join(dir, `ffmpeg${exe}`),
        ffprobe: path.join(dir, `ffprobe${exe}`),
    };
    let found: Promise<ToolPaths | null> | undefined;
    let checkedAt = 0;
    let download: Promise<ToolPaths | null> | undefined;
    let state: SetupState = { phase: 'unavailable', reason: 'not checked' };

    function works(command: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const child = spawn(command, ['-version'], { stdio: 'ignore' });
                const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
                child.on('error', () => {
                    clearTimeout(timer);
                    resolve(false);
                });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    resolve(code === 0);
                });
            } catch {
                resolve(false);
            }
        });
    }

    async function locate(): Promise<ToolPaths | null> {
        const candidates: ToolPaths[] = [];
        if (env['MEDDL_FFMPEG'])
            candidates.push({ ffmpeg: env['MEDDL_FFMPEG'], ffprobe: env['MEDDL_FFPROBE'] ?? 'ffprobe' });
        if (existsSync(downloaded.ffmpeg)) candidates.push(downloaded);
        candidates.push({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
        for (const candidate of candidates)
            if (await works(candidate.ffmpeg)) {
                state = { phase: 'ready' };
                return candidate;
            }
        state =
            platform === 'win32'
                ? { phase: 'unavailable', reason: 'not downloaded yet' }
                : { phase: 'unavailable', reason: 'FFmpeg is not installed on this server.' };
        return null;
    }

    async function fetchWindowsBuild(): Promise<ToolPaths | null> {
        const get = options.fetch ?? fetch;
        await fs.mkdir(dir, { recursive: true });
        const archive = path.join(tmpdir(), `meddl-ffmpeg-${process.pid}.zip`);
        for (const url of WINDOWS_BUILDS) {
            try {
                const response = await get(url, { redirect: 'follow' });
                if (!response.ok || !response.body) continue;
                const total = Number(response.headers.get('content-length')) || 0;
                state = { phase: 'downloading', received: 0, total };
                const body = Readable.fromWeb(response.body as never);
                body.on('data', (chunk: Buffer) => {
                    if (state.phase === 'downloading') state = { ...state, received: state.received + chunk.length };
                });
                await pipeline(body, createWriteStream(archive));
                for (const name of ['ffmpeg', 'ffprobe'] as const) {
                    const data = await readZipEntry(archive, (entry) => entry.endsWith(`/bin/${name}.exe`));
                    if (!data) throw new Error(`${name}.exe missing in archive`);
                    await fs.writeFile(`${downloaded[name]}.part`, data);
                    await fs.rename(`${downloaded[name]}.part`, downloaded[name]);
                }
                await fs.rm(archive, { force: true });
                if (await works(downloaded.ffmpeg)) {
                    state = { phase: 'ready' };
                    return downloaded;
                }
            } catch {
                await fs.rm(archive, { force: true }).catch(() => undefined);
            }
        }
        state = { phase: 'unavailable', reason: 'FFmpeg could not be downloaded.' };
        return null;
    }

    return {
        /** Tools when usable now; starts the Windows download when missing. */
        async ready(): Promise<ToolPaths | null> {
            // Installed later (PATH)? Look again once a minute.
            if (found && state.phase === 'unavailable' && !download && Date.now() - checkedAt > 60000)
                found = undefined;
            if (!found) checkedAt = Date.now();
            const tools = await (found ??= locate());
            if (tools) return tools;
            if (platform !== 'win32') return null;
            download ??= fetchWindowsBuild().then((result) => {
                if (result) found = Promise.resolve(result);
                else download = undefined; // allow another attempt later
                return result;
            });
            return null;
        },
        state: () => state,
    };
}
