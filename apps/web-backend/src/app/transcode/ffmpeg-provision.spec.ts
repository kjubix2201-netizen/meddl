import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createFfmpegTools } from './ffmpeg-provision';
import { readZipEntry } from './zip-reader';

/** Minimal ZIP writer (deflated entries) for the fixtures. */
function zip(files: Record<string, Buffer>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, data] of Object.entries(files)) {
        const packed = deflateRawSync(data);
        const nameBytes = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, packed);
        centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + packed.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

/** `-version` succeeds only for executables that exist on disk. */
const fakeSpawn = ((command: string) => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void };
    child.kill = () => undefined;
    setTimeout(() =>
        existsSync(command) ? child.emit('close', 0) : child.emit('error', new Error('ENOENT'))
    );
    return child;
}) as never;

const program = Buffer.concat([Buffer.alloc(50000, 7), Buffer.from('ffmpeg')]);
const archive = zip({
    'ffmpeg-master-latest-win64-lgpl/bin/ffmpeg.exe': program,
    'ffmpeg-master-latest-win64-lgpl/bin/ffprobe.exe': Buffer.from('probe'),
    'ffmpeg-master-latest-win64-lgpl/LICENSE.txt': Buffer.from('LGPL'),
});

describe('FFmpeg provisioning', () => {
    it('reads entries out of a ZIP archive', async () => {
        const file = path.join(mkdtempSync(path.join(tmpdir(), 'meddl-zip-')), 'a.zip');
        writeFileSync(file, archive);
        await expect(readZipEntry(file, (n) => n.endsWith('/bin/ffmpeg.exe'))).resolves.toEqual(program);
        await expect(readZipEntry(file, (n) => n.endsWith('missing'))).resolves.toBeNull();
    });

    it('downloads FFmpeg once on Windows and finds it again after a restart', async () => {
        const dataDir = mkdtempSync(path.join(tmpdir(), 'meddl-ff-'));
        let fetches = 0;
        const fetchArchive = (async () => {
            fetches += 1;
            return new Response(archive, { headers: { 'content-length': String(archive.length) } });
        }) as typeof fetch;
        const tools = createFfmpegTools({ spawn: fakeSpawn, dataDir, platform: 'win32', fetch: fetchArchive, env: {} });
        await expect(tools.ready()).resolves.toBeNull();
        for (let i = 0; i < 200 && tools.state().phase !== 'ready'; i++)
            await new Promise((resolve) => setTimeout(resolve, 10));
        const paths = await tools.ready();
        expect(paths?.ffmpeg).toBe(path.join(dataDir, 'ffmpeg', 'ffmpeg.exe'));
        expect(readFileSync(paths!.ffmpeg)).toEqual(program);

        const restarted = createFfmpegTools({ spawn: fakeSpawn, dataDir, platform: 'win32', fetch: fetchArchive, env: {} });
        await expect(restarted.ready()).resolves.toEqual(paths);
        expect(fetches).toBe(1);
    });

    it('never downloads on Linux, where the image or package provides FFmpeg', async () => {
        const fetchNever = jest.fn() as unknown as typeof fetch;
        const tools = createFfmpegTools({
            spawn: fakeSpawn,
            dataDir: mkdtempSync(path.join(tmpdir(), 'meddl-lx-')),
            platform: 'linux',
            fetch: fetchNever,
            env: {},
        });
        await expect(tools.ready()).resolves.toBeNull();
        expect(tools.state().phase).toBe('unavailable');
        expect(fetchNever).not.toHaveBeenCalled();
    });
});
