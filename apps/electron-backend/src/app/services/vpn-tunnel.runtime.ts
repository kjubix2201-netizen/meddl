import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { app, safeStorage, session } from 'electron';
import App from '../app';
import {
    store,
    VPN_AUTOSTART,
    VPN_LOCK,
    VPN_PROFILE,
    VPN_PROFILE_NAME,
} from './store.service';
import type {
    StoredVpn,
    TunnelProcess,
    VpnState,
    VpnTunnelRuntime,
} from './vpn-tunnel.service';

/**
 * The built-in VPN's hold on the real world: the bundled tunnel program,
 * the settings file, and Chromium's proxy setting (vpn-tunnel.service.ts
 * has the behaviour).
 */

/** Pushed to the page whenever the VPN's state changes. */
export const VPN_CHANGED = 'meddl:vpn-changed';

/**
 * wireproxy under a name of meddl's own, so a copy left behind by a crash
 * can be told apart from anything else on the computer and ended.
 */
export const VPN_TUNNEL_BINARY = 'meddl-vpn-tunnel.exe';

/**
 * Never through the VPN: this computer and the home network (a meddl
 * server or library there is not reachable through a VPN anyway).
 */
const LOCAL_BYPASS =
    '<local>;*.local;10.0.0.0/8;172.16.0.0/12;192.168.0.0/16;169.254.0.0/16';

const NONE: StoredVpn = { profile: '', name: '', autostart: false, lock: false };

function binaryPath(): string | null {
    const override = process.env['MEDDL_VPN_TUNNEL_BINARY'];
    if (override) {
        return existsSync(override) ? override : null;
    }
    // Built for the Windows installer only (.github/workflows/build.yml).
    if (process.platform !== 'win32' || !app.isPackaged) {
        return null;
    }
    const bundled = join(process.resourcesPath, 'vpn-tunnel', VPN_TUNNEL_BINARY);
    return existsSync(bundled) ? bundled : null;
}

function startProcess(
    binary: string,
    args: string[],
    env: Record<string, string>
): TunnelProcess {
    const child = spawn(binary, args, {
        env: { ...process.env, ...env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The last lines only: they say why a start failed. Keys are never in
    // them (the program does not print its configuration).
    let output = '';
    const keep = (chunk: Buffer) => {
        output = `${output}${chunk.toString('utf8')}`.slice(-2000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let ended: string | null = null;
    let listener: ((text: string) => void) | null = null;
    const end = (text: string) => {
        if (ended !== null) {
            return;
        }
        ended = text;
        listener?.(text);
    };
    child.once('error', (error) => end(`${output}\n${error.message}`));
    child.once('exit', () => end(output));
    return {
        onExit: (next) => {
            listener = next;
            if (ended !== null) {
                next(ended);
            }
        },
        kill: () => {
            try {
                child.kill();
            } catch {
                // Already gone.
            }
        },
    };
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const port = address && typeof address === 'object' ? address.port : 0;
            probe.close(() => (port ? resolve(port) : reject(new Error('No free port.'))));
        });
    });
}

/** From the tunnel's own status page (the same figures as `wg show`). */
async function handshakeAge(infoPort: number): Promise<number | null> {
    try {
        const response = await fetch(`http://127.0.0.1:${infoPort}/metrics`, {
            signal: AbortSignal.timeout(2_000),
        });
        const text = await response.text();
        const latest = Math.max(
            0,
            ...[...text.matchAll(/last_handshake_time_sec=(\d+)/g)].map((m) => Number(m[1]))
        );
        return latest > 0 ? Math.max(0, Date.now() / 1000 - latest) : null;
    } catch {
        return null;
    }
}

export function createVpnTunnelRuntime(): VpnTunnelRuntime {
    let cached: StoredVpn | null = null;
    return {
        binary: binaryPath,
        workDir: () => join(app.getPath('userData'), 'vpn'),
        read: () => {
            if (cached) {
                return cached;
            }
            let profile = '';
            const sealed = store.get(VPN_PROFILE, '');
            if (sealed) {
                try {
                    profile = safeStorage.decryptString(Buffer.from(sealed, 'base64'));
                } catch {
                    // Another Windows account or a restored backup: the
                    // profile has to be added again.
                    profile = '';
                }
            }
            cached = profile
                ? {
                      profile,
                      name: store.get(VPN_PROFILE_NAME, ''),
                      autostart: store.get(VPN_AUTOSTART, false) === true,
                      lock: store.get(VPN_LOCK, false) === true,
                  }
                : NONE;
            return cached;
        },
        write: (next) => {
            if (next.profile && !safeStorage.isEncryptionAvailable()) {
                throw new Error('This computer cannot keep the VPN profile safe.');
            }
            // The profile holds the viewer's private key: sealed with the
            // Windows account's own key, never stored as plain text.
            store.set(
                VPN_PROFILE,
                next.profile ? safeStorage.encryptString(next.profile).toString('base64') : ''
            );
            store.set(VPN_PROFILE_NAME, next.name);
            store.set(VPN_AUTOSTART, next.autostart);
            store.set(VPN_LOCK, next.lock);
            cached = next.profile ? { ...next } : NONE;
        },
        writeFile: (path, text) => {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
        },
        removeFile: (path) => rmSync(path, { force: true }),
        spawn: startProcess,
        freePort,
        handshakeAge,
        reapStale: () =>
            new Promise((resolve) => {
                if (process.platform !== 'win32' || binaryPath() === null) {
                    resolve();
                    return;
                }
                // Only one meddl runs at a time (single-instance.ts), so a
                // tunnel still around belongs to a run that crashed.
                execFile(
                    'taskkill',
                    ['/IM', VPN_TUNNEL_BINARY, '/F'],
                    { windowsHide: true },
                    () => resolve()
                );
            }),
        route: async (proxyUrl) => {
            await session.defaultSession.setProxy(
                proxyUrl
                    ? { proxyRules: proxyUrl, proxyBypassRules: LOCAL_BYPASS }
                    : { mode: 'system' }
            );
            // Connections opened the other way must not be reused.
            await session.defaultSession.closeAllConnections();
        },
        notify: (state: VpnState) => {
            const window = App.mainWindow;
            if (window && !window.isDestroyed()) {
                window.webContents.send(VPN_CHANGED, state);
            }
        },
    };
}
