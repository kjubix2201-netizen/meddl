import { promises as fs } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * Reads one file out of a ZIP archive (stored or deflated, ZIP64 aware).
 * Enough for unpacking the FFmpeg download without an extra dependency.
 */
export async function readZipEntry(
    file: string,
    match: (name: string) => boolean
): Promise<Buffer | null> {
    const handle = await fs.open(file, 'r');
    try {
        const { size } = await handle.stat();
        const read = async (position: number, length: number) => {
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, position);
            return buffer;
        };
        // End of central directory: in the last 64 KiB + 22 bytes.
        const tailLength = Math.min(size, 65557);
        const tail = await read(size - tailLength, tailLength);
        let eocd = -1;
        for (let i = tail.length - 22; i >= 0; i--)
            if (tail.readUInt32LE(i) === 0x06054b50) {
                eocd = i;
                break;
            }
        if (eocd < 0) throw new Error('Not a ZIP archive');
        let entries = tail.readUInt16LE(eocd + 10);
        let directorySize = tail.readUInt32LE(eocd + 12);
        let directoryOffset = tail.readUInt32LE(eocd + 16);
        if (directoryOffset === 0xffffffff || entries === 0xffff) {
            // ZIP64 locator sits right before the classic record.
            const locator = eocd - 20;
            if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50)
                throw new Error('Broken ZIP64 archive');
            const record = await read(Number(tail.readBigUInt64LE(locator + 8)), 56);
            entries = Number(record.readBigUInt64LE(32));
            directorySize = Number(record.readBigUInt64LE(40));
            directoryOffset = Number(record.readBigUInt64LE(48));
        }
        const directory = await read(directoryOffset, directorySize);
        let at = 0;
        for (let n = 0; n < entries && at + 46 <= directory.length; n++) {
            if (directory.readUInt32LE(at) !== 0x02014b50) break;
            const method = directory.readUInt16LE(at + 10);
            let compressed = directory.readUInt32LE(at + 20);
            let uncompressed = directory.readUInt32LE(at + 24);
            const nameLength = directory.readUInt16LE(at + 28);
            const extraLength = directory.readUInt16LE(at + 30);
            const commentLength = directory.readUInt16LE(at + 32);
            let local = directory.readUInt32LE(at + 42);
            const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
            const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
            at += 46 + nameLength + extraLength + commentLength;
            if (!match(name)) continue;
            // ZIP64 extra field: only the values that overflowed, in order.
            for (let e = 0; e + 4 <= extra.length; ) {
                const id = extra.readUInt16LE(e);
                const length = extra.readUInt16LE(e + 2);
                if (id === 0x0001) {
                    let v = e + 4;
                    if (uncompressed === 0xffffffff) (uncompressed = Number(extra.readBigUInt64LE(v))), (v += 8);
                    if (compressed === 0xffffffff) (compressed = Number(extra.readBigUInt64LE(v))), (v += 8);
                    if (local === 0xffffffff) local = Number(extra.readBigUInt64LE(v));
                }
                e += 4 + length;
            }
            const header = await read(local, 30);
            if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Broken ZIP entry');
            const start = local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
            const data = await read(start, compressed);
            if (method === 0) return data;
            if (method === 8) {
                const output = inflateRawSync(data);
                if (output.length !== uncompressed) throw new Error('ZIP entry size mismatch');
                return output;
            }
            throw new Error(`Unsupported ZIP method ${method}`);
        }
        return null;
    } finally {
        await handle.close();
    }
}
