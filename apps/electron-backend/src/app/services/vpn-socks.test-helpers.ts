import { connect, createServer, type AddressInfo, type Socket } from 'node:net';

/**
 * A minimal SOCKS5 server (no login) for the VPN tests: it stands in for
 * the tunnel program, records where it was asked to go, and connects to
 * wherever `route` says (null: refuse).
 */
export function fakeSocks(
    route: (host: string, port: number) => { host: string; port: number } | null
) {
    const asked: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((client) => {
        sockets.add(client);
        client.on('error', () => client.destroy());
        let stage = 0;
        let buffered = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            if (stage === 0 && buffered.length >= 3) {
                buffered = buffered.subarray(3);
                client.write(Buffer.from([0x05, 0x00]));
                stage = 1;
            }
            if (stage !== 1 || buffered.length < 5) return;
            const type = buffered[3];
            const length = type === 0x01 ? 4 : type === 0x04 ? 16 : buffered[4] + 1;
            if (buffered.length < 4 + length + 2) return;
            const address = buffered.subarray(4, 4 + length);
            const host =
                type === 0x01
                    ? Array.from(address).join('.')
                    : type === 0x04
                      ? `v6:${address.toString('hex')}`
                      : address.subarray(1).toString('utf8');
            const port = buffered.readUInt16BE(4 + length);
            const rest = buffered.subarray(4 + length + 2);
            asked.push(`${host}:${port}`);
            client.off('data', onData);
            const target = route(host, port);
            if (!target) {
                client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                return;
            }
            const upstream = connect(target.port, target.host, () => {
                client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
                if (rest.length) upstream.write(rest);
                client.pipe(upstream);
                upstream.pipe(client);
            });
            sockets.add(upstream);
            upstream.on('error', () => client.destroy());
            client.on('close', () => upstream.destroy());
        };
        client.on('data', onData);
    });
    return {
        asked,
        listen: () =>
            new Promise<number>((resolve) =>
                server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
            ),
        close: () =>
            new Promise<void>((resolve) => {
                sockets.forEach((socket) => socket.destroy());
                server.close(() => resolve());
            }),
    };
}

/** Sends everything for the test's own machine on, whatever name was asked. */
export const toLocalhost = (_host: string, port: number) => ({ host: '127.0.0.1', port });
