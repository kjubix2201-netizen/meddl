import type { SocksAddress } from './vpn-http-bridge';

/**
 * What the rest of the main process needs to know about the built-in VPN
 * (vpn-tunnel.service.ts), without loading it: whether meddl's traffic is
 * routed through the VPN right now, and where to send it. Kept free of
 * Electron so the players' and fetchers' own tests stay small.
 */
export interface VpnRouting {
    /** HTTP proxy for the page and the MPV player; null: connect directly. */
    proxyUrl: string | null;
    /** The tunnel's SOCKS5 proxy; null unless the VPN is connected. */
    socks: SocksAddress | null;
}

const DIRECT: VpnRouting = { proxyUrl: null, socks: null };
let current: () => VpnRouting = () => DIRECT;

/** Called once by the VPN service when the app starts. */
export function setVpnRouting(provider: () => VpnRouting): void {
    current = provider;
}

/** The proxy all of meddl's traffic must use right now, or null. */
export function vpnProxyUrl(): string | null {
    return current().proxyUrl;
}

export function vpnSocksAddress(): SocksAddress | null {
    return current().socks;
}

/**
 * The tunnel carries HTTP and HTTPS. Anything else (RTMP, RTSP, UDP) would
 * leave the computer beside it, so it is refused while traffic is routed.
 */
export function assertVpnCanCarry(url: string): void {
    if (vpnProxyUrl() !== null && !/^https?:\/\//i.test(url)) {
        throw new Error(
            'With the VPN on, only HTTP and HTTPS streams can be played.'
        );
    }
}
