import {
    buildTunnelConfig,
    parseVpnProfile,
    tunnelEnvironment,
    VPN_FALLBACK_DNS,
    VPN_PRIVATE_KEY_ENV,
    VpnProfileError,
    vpnProfileServer,
} from './vpn-profile';

// Keys of the right shape (32 bytes, base64); they belong to nothing.
const PRIVATE = Buffer.alloc(32, 1).toString('base64');
const PUBLIC = Buffer.alloc(32, 2).toString('base64');
const SHARED = Buffer.alloc(32, 3).toString('base64');

const profile = (extra = '') => `[Interface]
# Key for free-de-01
PrivateKey = ${PRIVATE}
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# DE-FREE#1
PublicKey = ${PUBLIC}
AllowedIPs = 0.0.0.0/0
Endpoint = 203.0.113.7:51820
${extra}`;

describe('parseVpnProfile', () => {
    it('reads a provider profile and ignores what the tunnel does not need', () => {
        expect(parseVpnProfile(profile())).toEqual({
            privateKey: PRIVATE,
            addresses: ['10.2.0.2/32'],
            dns: ['10.2.0.1'],
            mtu: null,
            publicKey: PUBLIC,
            presharedKey: null,
            endpoint: '203.0.113.7:51820',
            persistentKeepalive: null,
        });
    });

    it('accepts Windows line ends, any key case, repeated and listed values', () => {
        const text = [
            '[interface]',
            `privatekey=${PRIVATE}`,
            'ADDRESS = 10.2.0.2/32, fd00::2/128',
            'Dns = 10.2.0.1',
            'DNS = 2001:db8::1 ; second server',
            'MTU = 1280',
            'Table = off',
            '[PEER]',
            `PublicKey = ${PUBLIC}`,
            `PresharedKey = ${SHARED}`,
            'Endpoint = vpn.example.net:443',
            'PersistentKeepalive = 15',
        ].join('\r\n');
        expect(parseVpnProfile(text)).toMatchObject({
            addresses: ['10.2.0.2/32', 'fd00::2/128'],
            dns: ['10.2.0.1', '2001:db8::1'],
            mtu: 1280,
            presharedKey: SHARED,
            endpoint: 'vpn.example.net:443',
            persistentKeepalive: 15,
        });
    });

    it.each([
        ['an empty file', ''],
        ['something that is no profile', 'hello world'],
        ['a missing peer', profile().split('[Peer]')[0]],
        ['two peers', `${profile()}\n[Peer]\nPublicKey = ${PUBLIC}\nEndpoint = 203.0.113.8:51820`],
        ['a malformed private key', profile().replace(PRIVATE, 'short')],
        ['a missing address', profile().replace('Address = 10.2.0.2/32', '')],
        ['an endpoint without a port', profile().replace(':51820', '')],
        ['a port out of range', profile().replace(':51820', ':99999')],
        ['a setting that would break out of its line', profile('PersistentKeepalive = 25x')],
        ['an oversized file', `${profile()}\n${'#'.repeat(9000)}`],
    ])('refuses %s', (_name, text) => {
        expect(() => parseVpnProfile(text)).toThrow(VpnProfileError);
    });

    it('names the server for the settings page', () => {
        expect(vpnProfileServer(parseVpnProfile(profile()))).toBe('203.0.113.7');
        expect(
            vpnProfileServer(
                parseVpnProfile(profile().replace('203.0.113.7:51820', '[2001:db8::7]:51820'))
            )
        ).toBe('2001:db8::7');
    });
});

describe('buildTunnelConfig', () => {
    it('writes the profile and a local SOCKS5 proxy, and names the private key instead of writing it', () => {
        const parsed = parseVpnProfile(profile());
        const config = buildTunnelConfig(parsed, 40123);
        expect(config).toBe(
            [
                '[Interface]',
                'Address = 10.2.0.2/32',
                `PrivateKey = $${VPN_PRIVATE_KEY_ENV}`,
                'DNS = 10.2.0.1',
                '',
                '[Peer]',
                `PublicKey = ${PUBLIC}`,
                'Endpoint = 203.0.113.7:51820',
                'PersistentKeepalive = 25',
                '',
                '[Socks5]',
                'BindAddress = 127.0.0.1:40123',
                '',
            ].join('\n')
        );
        expect(config).not.toContain(PRIVATE);
        expect(tunnelEnvironment(parsed)).toEqual({ [VPN_PRIVATE_KEY_ENV]: PRIVATE });
    });

    it('writes a preshared key as the tunnel program reads it', () => {
        const parsed = parseVpnProfile(profile(`PresharedKey = ${SHARED}`));
        const config = buildTunnelConfig(parsed, 1);
        expect(config).toContain(`PreSharedKey = ${SHARED}`);
        expect(config).not.toContain(PRIVATE);
        expect(tunnelEnvironment(parsed)).toEqual({ [VPN_PRIVATE_KEY_ENV]: PRIVATE });
    });

    it('keeps the provider\'s own keepalive and MTU, and never leaves names to this computer', () => {
        const parsed = parseVpnProfile(
            profile('PersistentKeepalive = 15').replace('DNS = 10.2.0.1', 'MTU = 1280')
        );
        const config = buildTunnelConfig(parsed, 1);
        expect(config).toContain('PersistentKeepalive = 15');
        expect(config).toContain('MTU = 1280');
        // No DNS in the profile: a resolver reached through the tunnel.
        expect(config).toContain(`DNS = ${VPN_FALLBACK_DNS}`);
        // A search domain is no server.
        const searching = parseVpnProfile(profile().replace('DNS = 10.2.0.1', 'DNS = 10.2.0.1, corp.example'));
        expect(searching.dns).toEqual(['10.2.0.1']);
    });
});
