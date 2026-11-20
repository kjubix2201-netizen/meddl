jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('./store.service', () => ({
    EMBEDDED_MPV_AUTO_RECONNECT: 'EMBEDDED_MPV_AUTO_RECONNECT',
    EMBEDDED_MPV_EXTRA_OPTIONS: 'EMBEDDED_MPV_EXTRA_OPTIONS',
    store: {
        get: (key: string, fallback: unknown) =>
            key === 'EMBEDDED_MPV_EXTRA_OPTIONS'
                ? 'http-proxy=http://my.own.proxy:3128'
                : fallback,
    },
}));

import { tvDirectFetch } from '../events/tv-direct-fetch.events';
import { readEmbeddedMpvSessionOptions } from './embedded-mpv-session-options';
import {
    assertVpnCanCarry,
    setVpnRouting,
    vpnProxyUrl,
    vpnSocksAddress,
} from './vpn-routing';

const DIRECT = { proxyUrl: null, socks: null };
const ROUTED_DOWN = { proxyUrl: 'http://127.0.0.1:41000', socks: null };

describe('VPN routing of the main process', () => {
    afterEach(() => setVpnRouting(() => DIRECT));

    it('is direct until the VPN says otherwise', () => {
        expect(vpnProxyUrl()).toBeNull();
        expect(vpnSocksAddress()).toBeNull();
        expect(() => assertVpnCanCarry('rtmp://streams.example/live')).not.toThrow();
    });

    it('lets only HTTP and HTTPS streams play while traffic is routed', () => {
        setVpnRouting(() => ROUTED_DOWN);
        expect(() => assertVpnCanCarry('http://streams.example/live/1.ts')).not.toThrow();
        expect(() => assertVpnCanCarry('HTTPS://streams.example/hls/1.m3u8')).not.toThrow();
        for (const url of ['rtmp://streams.example/live', 'udp://239.0.0.1:1234', 'rtsp://cam.example/1', '']) {
            expect(() => assertVpnCanCarry(url)).toThrow('only HTTP and HTTPS');
        }
    });

    it('points the MPV player at the VPN, after and so above the user\'s own proxy line', () => {
        const own = readEmbeddedMpvSessionOptions().extraOptions;
        expect(own).toContain('http-proxy=http://my.own.proxy:3128');
        expect(own.some((line) => line.includes('127.0.0.1'))).toBe(false);
        setVpnRouting(() => ROUTED_DOWN);
        const routed = readEmbeddedMpvSessionOptions().extraOptions;
        expect(routed.at(-1)).toBe('http-proxy=http://127.0.0.1:41000');
        expect(routed.slice(0, -1)).toEqual(own);
    });

    it('sends provider requests through the tunnel while routed, and fails them when it is down', async () => {
        setVpnRouting(() => ROUTED_DOWN);
        const direct = jest.spyOn(globalThis, 'fetch');
        await expect(
            tvDirectFetch({ url: 'http://panel.example/player_api.php' })
        ).rejects.toThrow('The VPN is not connected');
        expect(direct).not.toHaveBeenCalled();
        direct.mockRestore();
    });
});
