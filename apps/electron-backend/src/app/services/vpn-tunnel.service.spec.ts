import { VPN_PRIVATE_KEY_ENV } from './vpn-profile';
import {
    VpnTunnelService,
    type StoredVpn,
    type VpnTunnelRuntime,
} from './vpn-tunnel.service';

const PRIVATE = Buffer.alloc(32, 1).toString('base64');
const PUBLIC = Buffer.alloc(32, 2).toString('base64');
const profile = (endpoint = 'de-free-1.vpn.example:51820') =>
    `[Interface]\nPrivateKey = ${PRIVATE}\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n\n[Peer]\nPublicKey = ${PUBLIC}\nEndpoint = ${endpoint}\n`;

/** Lets real socket work (the local bridge) and pending promises run. */
const settle = async () => {
    for (let turn = 0; turn < 5; turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};
const pass = async (ms: number) => {
    await jest.advanceTimersByTimeAsync(ms);
    await settle();
};

function harness(initial: Partial<StoredVpn> = {}) {
    let stored: StoredVpn = { profile: '', name: '', autostart: false, lock: false, ...initial };
    const events: string[] = [];
    const files = new Map<string, string>();
    const processes: {
        args: string[];
        env: Record<string, string>;
        config: string;
        killed: boolean;
        exit(output?: string): void;
    }[] = [];
    const world = { age: null as number | null, binary: 'C:/meddl/vpn-tunnel/meddl-vpn-tunnel.exe' as string | null };
    let port = 40000;
    const runtime: VpnTunnelRuntime = {
        binary: () => world.binary,
        workDir: () => 'C:/userData/vpn',
        read: () => stored,
        write: (next) => {
            stored = { ...next };
        },
        writeFile: (path, text) => {
            files.set(path, text);
        },
        removeFile: (path) => {
            if (files.delete(path)) events.push('config removed');
        },
        spawn: (_binary, args, env) => {
            let listener: (output: string) => void = () => undefined;
            const record = {
                args,
                env,
                config: files.get(args[2]) ?? '',
                killed: false,
                exit: (output = '') => listener(output),
            };
            processes.push(record);
            events.push('spawn');
            return {
                onExit: (next) => {
                    listener = next;
                },
                kill: () => {
                    record.killed = true;
                    events.push('kill');
                },
            };
        },
        freePort: async () => ++port,
        handshakeAge: async () => world.age,
        reapStale: async () => {
            events.push('reap');
        },
        route: async (url) => {
            events.push(url ? 'route vpn' : 'route direct');
        },
        notify: (state) => {
            events.push(`${state.state}${state.error ? ` (${state.error})` : ''}`);
        },
    };
    const service = new VpnTunnelService(runtime);
    return { service, events, files, processes, world, stored: () => stored };
}

describe('VpnTunnelService', () => {
    const services: VpnTunnelService[] = [];
    const create = (initial?: Partial<StoredVpn>) => {
        const made = harness(initial);
        services.push(made.service);
        return made;
    };
    /** A service with a profile, connected. */
    async function connected(initial: Partial<StoredVpn> = {}) {
        const made = create({ profile: profile(), name: 'Proton', ...initial });
        void made.service.connect();
        await settle();
        made.world.age = 1;
        await pass(500);
        expect(made.service.state().state).toBe('up');
        made.events.length = 0;
        return made;
    }

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });
    afterEach(async () => {
        await Promise.all(services.splice(0).map((service) => service.dispose()));
        jest.useRealTimers();
    });

    it('is off and leaves everything direct until a profile is there', async () => {
        const { service, events } = create();
        await service.start();
        expect(service.state()).toEqual({
            available: true,
            configured: false,
            state: 'down',
            error: '',
            autostart: false,
            lock: false,
            name: '',
        });
        expect(service.proxyUrl()).toBeNull();
        expect(service.socksAddress()).toBeNull();
        await service.connect();
        expect(events).toEqual([]);
    });

    it('refuses what is no profile, and says so when this build has no tunnel', async () => {
        const { service, world, stored } = create();
        expect(await service.importProfile('not a profile', 'x')).toBe('invalid');
        expect(stored().profile).toBe('');
        world.binary = null;
        expect(await service.importProfile(profile(), 'x')).toBe('unavailable');
        expect(service.state().available).toBe(false);
    });

    it('connects: routes first, starts the tunnel with the key in its environment only, and is up after the handshake', async () => {
        const { service, events, files, processes, world } = create();
        expect(await service.importProfile(profile(), '  Proton DE  ')).toBe('');
        expect(service.state()).toMatchObject({ configured: true, name: 'Proton DE', server: 'de-free-1.vpn.example' });
        expect(service.proxyUrl()).toBeNull();
        void service.connect();
        await settle();
        expect(events).toEqual(['down', 'connecting', 'route vpn', 'spawn']);
        expect(service.proxyUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        // Routed but not connected yet: nothing gets through.
        expect(service.socksAddress()).toBeNull();
        const [tunnel] = processes;
        expect(tunnel.args).toEqual(['-s', '-c', expect.stringMatching(/tunnel\.conf$/), '-i', '127.0.0.1:40002']);
        expect(tunnel.env).toEqual({ [VPN_PRIVATE_KEY_ENV]: PRIVATE });
        expect(tunnel.config).toContain('BindAddress = 127.0.0.1:40001');
        expect(tunnel.config).not.toContain(PRIVATE);
        await pass(1500);
        expect(service.state().state).toBe('connecting');
        world.age = 0.4;
        await pass(500);
        expect(service.state()).toMatchObject({ state: 'up', error: '' });
        expect(service.socksAddress()).toEqual({ host: '127.0.0.1', port: 40001 });
        expect(files.size).toBe(0);
        expect(events.slice(4)).toEqual(['up', 'config removed']);
    });

    it('reports why a start failed and goes back to direct connections', async () => {
        const { service, events, processes } = create({ profile: profile() });
        void service.connect();
        await settle();
        processes[0].exit('lookup de-free-1.vpn.example: no such host');
        await pass(500);
        expect(service.state()).toMatchObject({ state: 'down', error: 'dns_resolution_failure' });
        expect(events.slice(-3)).toEqual(['down (dns_resolution_failure)', 'route direct', 'config removed']);
        expect(service.proxyUrl()).toBeNull();
        await pass(60_000);
        expect(processes).toHaveLength(1);

        // A server that never answers: given up after a while, the program ended.
        void service.connect();
        await settle();
        await pass(21_000);
        expect(service.state()).toMatchObject({ state: 'down', error: 'failed' });
        expect(processes[1].killed).toBe(true);
    });

    it('disconnects on request: the tunnel ends and traffic is direct again', async () => {
        const { service, events, processes } = await connected();
        await service.disconnect();
        expect(processes[0].killed).toBe(true);
        expect(events).toEqual(['kill', 'down', 'route direct']);
        expect(service.socksAddress()).toBeNull();
        expect(service.proxyUrl()).toBeNull();
    });

    it('without the lock a tunnel that ends by itself stays down', async () => {
        const { service, events, processes } = await connected();
        processes[0].exit('');
        await pass(60_000);
        expect(events).toEqual(['down (failed)', 'route direct']);
        expect(processes).toHaveLength(1);
        expect(service.proxyUrl()).toBeNull();
    });

    it('with the lock traffic stays routed while the tunnel is down, and the tunnel comes back by itself', async () => {
        const { service, events, processes, world } = await connected({ lock: true });
        world.age = null;
        processes[0].exit('');
        await settle();
        expect(service.state().state).toBe('down');
        // Fail closed: still pointed at the VPN, with nothing behind it.
        expect(service.proxyUrl()).not.toBeNull();
        expect(service.socksAddress()).toBeNull();
        expect(events).not.toContain('route direct');
        await pass(2_000);
        expect(processes).toHaveLength(2);
        processes[1].exit('');
        await pass(500);
        // The second try waits longer.
        await pass(2_000);
        expect(processes).toHaveLength(2);
        await pass(3_000);
        expect(processes).toHaveLength(3);
        world.age = 1;
        await pass(500);
        expect(service.state().state).toBe('up');

        // "Disconnect" is the viewer's word: no reconnect, and still no direct traffic.
        await service.disconnect();
        await pass(120_000);
        expect(processes).toHaveLength(3);
        expect(service.proxyUrl()).not.toBeNull();
        expect(events).not.toContain('route direct');
        await service.setLock(false);
        expect(service.proxyUrl()).toBeNull();
        expect(events.at(-2)).toBe('route direct');
    });

    it('at app start the lock routes before anything else, clears a leftover tunnel and connects', async () => {
        const locked = create({ profile: profile(), lock: true });
        await locked.service.start();
        await settle();
        expect(locked.events.slice(0, 2)).toEqual(['route vpn', 'reap']);
        expect(locked.events).toContain('spawn');
        expect(locked.service.proxyUrl()).not.toBeNull();

        const auto = create({ profile: profile(), autostart: true });
        await auto.service.start();
        await settle();
        expect(auto.events).toContain('spawn');

        const manual = create({ profile: profile() });
        await manual.service.start();
        await settle();
        expect(manual.events).toEqual(['reap']);
        expect(manual.service.proxyUrl()).toBeNull();
    });

    it('shows a silent server as connecting, and starts the tunnel afresh when it stays silent, never going direct', async () => {
        const { service, events, processes, world } = await connected();
        world.age = 400;
        await pass(20_000);
        expect(service.state().state).toBe('connecting');
        world.age = 2;
        await pass(20_000);
        expect(service.state().state).toBe('up');
        expect(processes).toHaveLength(1);

        world.age = null;
        await pass(120_000);
        expect(processes[0].killed).toBe(true);
        expect(processes).toHaveLength(2);
        expect(events).not.toContain('route direct');
        world.age = 1;
        await pass(500);
        expect(service.state().state).toBe('up');
        expect(service.socksAddress()).toEqual({ host: '127.0.0.1', port: 40003 });
    });

    it('a replaced profile takes over a running connection; removing it ends everything', async () => {
        const { service, events, processes, stored } = await connected({ lock: true, autostart: true });
        expect(await service.importProfile(profile('nl-free-2.vpn.example:51820'), 'Proton NL')).toBe('');
        await settle();
        expect(processes[0].killed).toBe(true);
        expect(processes).toHaveLength(2);
        expect(service.state()).toMatchObject({ name: 'Proton NL', server: 'nl-free-2.vpn.example', lock: true });
        await pass(500);
        expect(service.state().state).toBe('up');

        await service.remove();
        expect(processes[1].killed).toBe(true);
        expect(stored()).toEqual({ profile: '', name: '', autostart: false, lock: false });
        expect(service.state()).toMatchObject({ configured: false, state: 'down', lock: false });
        expect(service.proxyUrl()).toBeNull();
        expect(events.at(-2)).toBe('route direct');
        await pass(120_000);
        expect(processes).toHaveLength(2);
    });
});
