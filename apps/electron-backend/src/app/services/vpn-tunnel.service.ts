import { join } from 'node:path';
import { VpnHttpBridge, type SocksAddress } from './vpn-http-bridge';
import {
    buildTunnelConfig,
    parseVpnProfile,
    tunnelEnvironment,
    VpnProfileError,
    vpnProfileServer,
} from './vpn-profile';

/**
 * The desktop app's built-in VPN, the counterpart of the Android TV app's
 * (MeddlVpn.kt): one WireGuard profile the viewer brings from their own
 * provider, for meddl's own traffic only. Windows has no per-app tunnel a
 * program may open without administrator rights, so the tunnel runs as a
 * bundled userspace program (wireproxy) that offers a SOCKS5 proxy on this
 * machine, and meddl sends its traffic there:
 *
 * - the page (Chromium) and the MPV player through the local HTTP bridge
 *   (vpn-http-bridge.ts),
 * - the main process's provider requests through vpn-fetch.ts.
 *
 * Other programs on the computer are untouched. While traffic is routed, a
 * request goes through the tunnel or fails; it never falls back to a direct
 * connection. With the lock ("only through the VPN") traffic stays routed
 * also while the tunnel is down, and the tunnel comes back by itself.
 *
 * Everything that touches Electron, the disk or a process is injected
 * (vpn-tunnel.runtime.ts), so the behaviour here is testable as it is.
 */

export type VpnConnection = 'down' | 'connecting' | 'up';

/** Same shape as the Android app reports (libs/tv/feature/src/vpn-shell.ts). */
export interface VpnState {
    available: boolean;
    configured: boolean;
    state: VpnConnection;
    error: string;
    autostart: boolean;
    lock: boolean;
    name: string;
    server?: string;
}

export interface StoredVpn {
    /** The profile as the provider wrote it; '' when there is none. */
    profile: string;
    name: string;
    autostart: boolean;
    lock: boolean;
}

export interface TunnelProcess {
    /** Called once, with the last lines the program wrote. */
    onExit(listener: (output: string) => void): void;
    kill(): void;
}

export interface VpnTunnelRuntime {
    /** The bundled tunnel program, or null when this build has none. */
    binary(): string | null;
    /** A folder of the app's own for the short-lived configuration file. */
    workDir(): string;
    read(): StoredVpn;
    write(next: StoredVpn): void;
    writeFile(path: string, text: string): void;
    removeFile(path: string): void;
    spawn(
        binary: string,
        args: string[],
        env: Record<string, string>
    ): TunnelProcess;
    freePort(): Promise<number>;
    /**
     * Seconds since the tunnel last shook hands with the server; null when
     * it has not yet (or does not answer).
     */
    handshakeAge(infoPort: number): Promise<number | null>;
    /** Ends a tunnel program a crashed run left behind. */
    reapStale(): Promise<void>;
    /** Points the page's traffic at the bridge, or back to direct (null). */
    route(proxyUrl: string | null): Promise<void>;
    notify(state: VpnState): void;
}

const CONNECT_TIMEOUT_MS = 20_000;
const POLL_MS = 500;
const WATCH_MS = 20_000;
/** WireGuard shakes hands every two minutes; older than this is a dead path. */
const STALE_HANDSHAKE_SECONDS = 180;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];
/** Two minutes without an answer: start the tunnel afresh. */
const RESTART_AFTER_SILENT_CHECKS = 6;
/** TCP port 1 (tcpmux): nothing listens there on a home computer. */
const UNANSWERED_PORT = 1;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the viewer can act on, from what the tunnel program wrote. */
function failureCode(output: string): string {
    if (/no such host|lookup .*(fail|timeout|no answer)|server misbehaving/i.test(output)) {
        return 'dns_resolution_failure';
    }
    if (/key should be|invalid|illegal base64|parse|should not be empty/i.test(output)) {
        return 'invalid';
    }
    return 'failed';
}

export class VpnTunnelService {
    private connection: VpnConnection = 'down';
    private error = '';
    /** The viewer pressed "Disconnect": no automatic reconnect. */
    private stoppedByViewer = false;
    private child: TunnelProcess | null = null;
    private socks: SocksAddress | null = null;
    private infoPort = 0;
    private attempt = 0;
    private retries = 0;
    private retryTimer: NodeJS.Timeout | null = null;
    private watchTimer: NodeJS.Timeout | null = null;
    private bridgePort = 0;
    private bridgeStarting: Promise<number> | null = null;
    /** What the page's traffic was last pointed at; it starts out direct. */
    private routed: string | null = null;
    private disposed = false;
    private readonly bridge = new VpnHttpBridge(() => this.socks);

    constructor(private readonly runtime: VpnTunnelRuntime) {}

    state(): VpnState {
        const stored = this.runtime.read();
        let server: string | undefined;
        if (stored.profile) {
            try {
                server = vpnProfileServer(parseVpnProfile(stored.profile));
            } catch {
                server = undefined;
            }
        }
        return {
            available: this.runtime.binary() !== null,
            configured: !!stored.profile,
            state: this.connection,
            error: this.error,
            autostart: stored.autostart,
            lock: stored.lock,
            name: stored.name,
            ...(server ? { server } : {}),
        };
    }

    /** Where the tunnel's SOCKS5 proxy listens; null unless connected. */
    socksAddress(): SocksAddress | null {
        return this.connection === 'up' ? this.socks : null;
    }

    /**
     * The HTTP proxy all of meddl's traffic must use right now, or null for
     * direct connections. Routed while connecting or connected, and with
     * the lock also while down (requests then fail instead of going out).
     */
    proxyUrl(): string | null {
        const stored = this.runtime.read();
        const routed =
            !!stored.profile &&
            // A build without the tunnel program has no VPN to wait for.
            this.runtime.binary() !== null &&
            (this.connection !== 'down' || stored.lock);
        if (!routed) {
            return null;
        }
        // Before the bridge listens (the first moments of a start with the
        // lock on): an address nothing answers at, so requests fail rather
        // than go out directly.
        return `http://127.0.0.1:${this.bridgePort || UNANSWERED_PORT}`;
    }

    /** At app start: the lock holds from the first request on. */
    async start(): Promise<void> {
        const stored = this.runtime.read();
        if (!stored.profile || this.runtime.binary() === null) {
            return;
        }
        await this.applyRouting();
        await this.runtime.reapStale();
        if (stored.autostart || stored.lock) {
            void this.connect();
        }
    }

    /** Saves a new profile; '' when it is usable, else the reason's code. */
    async importProfile(text: string, name: string): Promise<string> {
        if (this.runtime.binary() === null) {
            return 'unavailable';
        }
        try {
            parseVpnProfile(text);
        } catch (error) {
            if (error instanceof VpnProfileError) {
                return 'invalid';
            }
            throw error;
        }
        const wasActive = this.connection !== 'down';
        await this.disconnect(false);
        this.runtime.write({
            ...this.runtime.read(),
            profile: text,
            name: name.trim().slice(0, 60),
        });
        this.error = '';
        await this.applyRouting();
        this.changed();
        // A replaced profile takes over what the old one was doing.
        if (wasActive || this.runtime.read().lock) {
            void this.connect();
        }
        return '';
    }

    async remove(): Promise<void> {
        await this.disconnect(false);
        this.runtime.write({ profile: '', name: '', autostart: false, lock: false });
        this.error = '';
        await this.applyRouting();
        this.changed();
    }

    async setAutostart(on: boolean): Promise<void> {
        this.runtime.write({ ...this.runtime.read(), autostart: on });
        this.changed();
    }

    async setLock(on: boolean): Promise<void> {
        this.runtime.write({ ...this.runtime.read(), lock: on });
        await this.applyRouting();
        this.changed();
        if (on && this.connection === 'down') {
            void this.connect();
        }
    }

    async connect(): Promise<void> {
        const binary = this.runtime.binary();
        const stored = this.runtime.read();
        if (!binary || !stored.profile || this.connection !== 'down' || this.disposed) {
            return;
        }
        this.clearRetry();
        this.stoppedByViewer = false;
        this.error = '';
        const attempt = ++this.attempt;
        this.setConnection('connecting');
        const configPath = join(this.runtime.workDir(), 'tunnel.conf');
        let child: TunnelProcess | null = null;
        try {
            await this.ensureBridge();
            await this.applyRouting();
            const profile = parseVpnProfile(stored.profile);
            const socksPort = await this.runtime.freePort();
            const infoPort = await this.runtime.freePort();
            this.runtime.writeFile(configPath, buildTunnelConfig(profile, socksPort));
            const exit: { output: string | null } = { output: null };
            child = this.runtime.spawn(
                binary,
                ['-s', '-c', configPath, '-i', `127.0.0.1:${infoPort}`],
                tunnelEnvironment(profile)
            );
            const started = child;
            this.child = started;
            started.onExit((text) => {
                exit.output = text;
                this.exited(started, text);
            });
            const deadline = Date.now() + CONNECT_TIMEOUT_MS;
            for (;;) {
                if (attempt !== this.attempt || this.child !== started) {
                    return;
                }
                if (exit.output !== null) {
                    throw new Error(failureCode(exit.output));
                }
                if ((await this.runtime.handshakeAge(infoPort)) !== null) {
                    break;
                }
                if (Date.now() > deadline) {
                    throw new Error('failed');
                }
                await sleep(POLL_MS);
            }
            if (attempt !== this.attempt || this.child !== started) {
                return;
            }
            this.socks = { host: '127.0.0.1', port: socksPort };
            this.infoPort = infoPort;
            this.retries = 0;
            this.setConnection('up');
            this.watch();
        } catch (error) {
            if (attempt !== this.attempt) {
                return;
            }
            const code = error instanceof VpnProfileError ? 'invalid' : String((error as Error)?.message || 'failed');
            if (this.child === child) {
                this.child = null;
            }
            child?.kill();
            this.fail(['dns_resolution_failure', 'invalid'].includes(code) ? code : 'failed');
        } finally {
            // The keys were only ever in the process's environment, but the
            // file may carry a preshared key: it does not outlive the start.
            this.runtime.removeFile(configPath);
        }
    }

    /** `byViewer`: pressed in Settings, so the lock does not reconnect. */
    async disconnect(byViewer = true): Promise<void> {
        this.attempt++;
        this.clearRetry();
        this.stopWatching();
        if (byViewer) {
            this.stoppedByViewer = true;
        }
        const child = this.child;
        this.child = null;
        this.socks = null;
        child?.kill();
        this.bridge.dropConnections();
        if (this.connection !== 'down') {
            this.setConnection('down');
        }
        await this.applyRouting();
    }

    /** At quit: the tunnel program must not outlive the app. */
    async dispose(): Promise<void> {
        this.disposed = true;
        await this.disconnect(false);
        await this.bridge.stop();
    }

    private ensureBridge(): Promise<number> {
        this.bridgeStarting ??= this.bridge.start().then((port) => (this.bridgePort = port));
        return this.bridgeStarting;
    }

    private async applyRouting(): Promise<void> {
        const stored = this.runtime.read();
        if (stored.profile && (stored.lock || this.connection !== 'down')) {
            await this.ensureBridge();
        }
        const proxyUrl = this.proxyUrl();
        if (proxyUrl === this.routed) {
            return;
        }
        this.routed = proxyUrl;
        await this.runtime.route(proxyUrl).catch(() => undefined);
    }

    private setConnection(next: VpnConnection): void {
        this.connection = next;
        this.changed();
    }

    private changed(): void {
        this.runtime.notify(this.state());
    }

    /** The tunnel program ended by itself. */
    private exited(child: TunnelProcess, output: string): void {
        if (this.child !== child || this.connection !== 'up') {
            // During a start the waiting loop reports it.
            return;
        }
        this.child = null;
        this.fail(failureCode(output));
    }

    private fail(code: string): void {
        this.stopWatching();
        this.socks = null;
        this.bridge.dropConnections();
        this.error = code;
        this.setConnection('down');
        void this.applyRouting();
        // The lock brings the tunnel back; without it the viewer decides.
        if (this.runtime.read().lock && !this.stoppedByViewer && !this.disposed) {
            const delay = RETRY_MS[Math.min(this.retries++, RETRY_MS.length - 1)];
            this.retryTimer = setTimeout(() => void this.connect(), delay);
        }
    }

    private clearRetry(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    /** A tunnel whose server stopped answering shows as "connecting". */
    private watch(): void {
        this.stopWatching();
        let silent = 0;
        this.watchTimer = setInterval(() => {
            const child = this.child;
            void this.runtime.handshakeAge(this.infoPort).then((age) => {
                if (this.child !== child || this.connection === 'down') {
                    return;
                }
                const alive = age !== null && age < STALE_HANDSHAKE_SECONDS;
                silent = alive ? 0 : silent + 1;
                if (alive !== (this.connection === 'up')) {
                    this.setConnection(alive ? 'up' : 'connecting');
                }
                if (silent >= RESTART_AFTER_SILENT_CHECKS) {
                    void this.restart();
                }
            });
        }, WATCH_MS);
    }

    /**
     * A path that stays dead gets a fresh tunnel: the program looks the
     * server's address up only when it starts. Traffic stays routed all the
     * while, so nothing goes out directly in between.
     */
    private async restart(): Promise<void> {
        this.attempt++;
        this.stopWatching();
        const child = this.child;
        this.child = null;
        this.socks = null;
        child?.kill();
        this.bridge.dropConnections();
        this.connection = 'down';
        await this.connect();
    }

    private stopWatching(): void {
        if (this.watchTimer) {
            clearInterval(this.watchTimer);
            this.watchTimer = null;
        }
    }
}
