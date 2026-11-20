/**
 * Settings → Connection → VPN of the desktop TV interface: the built-in VPN
 * for meddl's own traffic (services/vpn-tunnel.service.ts). The page talks
 * to it through `window.meddlDesktop.vpn` (api/main.preload.ts) in the same
 * terms the Android TV app uses (libs/tv/feature/src/vpn-shell.ts).
 */
import { app, ipcMain } from 'electron';
import { setVpnRouting } from '../services/vpn-routing';
import { createVpnTunnelRuntime } from '../services/vpn-tunnel.runtime';
import { VpnTunnelService } from '../services/vpn-tunnel.service';

export const VPN_STATE = 'meddl:vpn-state';
export const VPN_IMPORT = 'meddl:vpn-import';
export const VPN_CONNECT = 'meddl:vpn-connect';
export const VPN_DISCONNECT = 'meddl:vpn-disconnect';
export const VPN_REMOVE = 'meddl:vpn-remove';
export const VPN_SET_AUTOSTART = 'meddl:vpn-set-autostart';
export const VPN_SET_LOCK = 'meddl:vpn-set-lock';

export function registerVpnHandlers(): void {
    const vpn = new VpnTunnelService(createVpnTunnelRuntime());
    setVpnRouting(() => ({
        proxyUrl: vpn.proxyUrl(),
        socks: vpn.socksAddress(),
    }));

    ipcMain.handle(VPN_STATE, () => vpn.state());
    ipcMain.handle(VPN_IMPORT, (_event, text: unknown, name: unknown) =>
        typeof text === 'string'
            ? vpn
                  .importProfile(text, typeof name === 'string' ? name : '')
                  .catch(() => 'failed')
            : 'invalid'
    );
    // Connecting takes a moment; its progress arrives as state changes.
    ipcMain.handle(VPN_CONNECT, () => void vpn.connect());
    ipcMain.handle(VPN_DISCONNECT, () => vpn.disconnect());
    ipcMain.handle(VPN_REMOVE, () => vpn.remove());
    ipcMain.handle(VPN_SET_AUTOSTART, (_event, on: unknown) =>
        vpn.setAutostart(on === true)
    );
    ipcMain.handle(VPN_SET_LOCK, (_event, on: unknown) =>
        vpn.setLock(on === true)
    );

    // The tunnel program must not outlive the app.
    app.once('will-quit', () => void vpn.dispose());
    void vpn.start();
}
