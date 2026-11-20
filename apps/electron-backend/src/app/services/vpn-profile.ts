/**
 * The viewer's WireGuard profile for the desktop app's built-in VPN: the
 * wg-quick file their own provider hands out (Proton VPN, Mullvad …), read
 * and checked here, and turned into the configuration of the bundled
 * userspace tunnel (wireproxy). The private key never enters that
 * configuration file: it reaches the tunnel process through its
 * environment. A preshared key (rare in provider profiles) has to be
 * written, because the tunnel program reads that one setting as it stands;
 * the file is removed again once the tunnel has started.
 */
import { isIP } from 'node:net';

/** Environment variable the tunnel configuration refers to for the key. */
export const VPN_PRIVATE_KEY_ENV = 'MEDDL_VPN_PRIVATE_KEY';
/**
 * Names are looked up through the tunnel, never by this computer: a profile
 * without a DNS setting gets this public resolver (reached through the VPN).
 */
export const VPN_FALLBACK_DNS = '1.1.1.1';

/** Profiles are small; anything larger is not a WireGuard file. */
export const VPN_PROFILE_MAX_LENGTH = 8000;

export interface VpnProfile {
    privateKey: string;
    addresses: string[];
    dns: string[];
    mtu: number | null;
    publicKey: string;
    presharedKey: string | null;
    /** `host:port` of the provider's server, as written in the profile. */
    endpoint: string;
    persistentKeepalive: number | null;
}

/** The only failure a viewer can act on: this is not a usable profile. */
export class VpnProfileError extends Error {
    constructor(reason: string) {
        super(`Not a usable WireGuard profile: ${reason}.`);
        this.name = 'VpnProfileError';
    }
}

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const ENDPOINT_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/;
const ADDRESS_PATTERN = /^[0-9A-Fa-f:.]+(\/\d{1,3})?$/;

function list(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function wholeNumber(
    value: string | undefined,
    name: string,
    min: number,
    max: number
): number | null {
    if (value === undefined || value.trim() === '') {
        return null;
    }
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new VpnProfileError(`${name} is out of range`);
    }
    return parsed;
}

/**
 * Reads a wg-quick profile with one peer. Keys are matched without regard
 * to case; settings the userspace tunnel has no use for (Table, PostUp,
 * AllowedIPs …) are ignored: everything meddl sends goes through the tunnel.
 */
export function parseVpnProfile(text: string): VpnProfile {
    if (typeof text !== 'string' || text.length > VPN_PROFILE_MAX_LENGTH) {
        throw new VpnProfileError('the file is too large');
    }
    const sections: { name: string; values: Map<string, string> }[] = [];
    for (const raw of text.replace(/\r/g, '').split('\n')) {
        const line = raw.replace(/[#;].*$/, '').trim();
        if (!line) {
            continue;
        }
        const header = line.match(/^\[([A-Za-z]+)\]$/);
        if (header) {
            sections.push({
                name: header[1].toLowerCase(),
                values: new Map(),
            });
            continue;
        }
        const at = line.indexOf('=');
        const section = sections[sections.length - 1];
        if (at <= 0 || !section) {
            throw new VpnProfileError('a line is neither a section nor a setting');
        }
        const key = line.slice(0, at).trim().toLowerCase();
        const value = line.slice(at + 1).trim();
        // Address and DNS may be repeated instead of comma-separated.
        const before = section.values.get(key);
        section.values.set(key, before ? `${before}, ${value}` : value);
    }
    const interfaces = sections.filter((s) => s.name === 'interface');
    const peers = sections.filter((s) => s.name === 'peer');
    if (interfaces.length !== 1 || peers.length !== 1) {
        throw new VpnProfileError('it needs one [Interface] and one [Peer]');
    }
    const own = interfaces[0].values;
    const peer = peers[0].values;

    const privateKey = own.get('privatekey') ?? '';
    const publicKey = peer.get('publickey') ?? '';
    const presharedKey = peer.get('presharedkey') ?? null;
    if (!KEY_PATTERN.test(privateKey) || !KEY_PATTERN.test(publicKey)) {
        throw new VpnProfileError('a key is missing or malformed');
    }
    if (presharedKey !== null && !KEY_PATTERN.test(presharedKey)) {
        throw new VpnProfileError('the preshared key is malformed');
    }
    const addresses = list(own.get('address'));
    if (!addresses.length || !addresses.every((a) => ADDRESS_PATTERN.test(a))) {
        throw new VpnProfileError('the address is missing or malformed');
    }
    const dnsEntries = list(own.get('dns'));
    if (!dnsEntries.every((entry) => /^[A-Za-z0-9:.-]+$/.test(entry))) {
        throw new VpnProfileError('the DNS setting is malformed');
    }
    // wg-quick also allows search domains there; only servers are of use.
    const dns = dnsEntries.filter((entry) => isIP(entry) !== 0);
    const endpoint = peer.get('endpoint') ?? '';
    const port = Number(endpoint.match(ENDPOINT_PATTERN)?.[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new VpnProfileError('the endpoint is missing or malformed');
    }
    return {
        privateKey,
        addresses,
        dns,
        mtu: wholeNumber(own.get('mtu'), 'MTU', 576, 65535),
        publicKey,
        presharedKey,
        endpoint,
        persistentKeepalive: wholeNumber(
            peer.get('persistentkeepalive'),
            'PersistentKeepalive',
            0,
            65535
        ),
    };
}

/** The server's host name or address, for the settings page. */
export function vpnProfileServer(profile: VpnProfile): string {
    return profile.endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
}

/**
 * The tunnel's configuration: the profile, a SOCKS5 proxy on this machine
 * only, and a keepalive so a quiet evening does not let the path through
 * the home router expire (it also makes the tunnel shake hands at once,
 * which is how its start is recognised). The private key is named, not
 * written (see the top).
 */
export function buildTunnelConfig(
    profile: VpnProfile,
    socksPort: number
): string {
    const lines = [
        '[Interface]',
        `Address = ${profile.addresses.join(', ')}`,
        `PrivateKey = $${VPN_PRIVATE_KEY_ENV}`,
        `DNS = ${(profile.dns.length ? profile.dns : [VPN_FALLBACK_DNS]).join(', ')}`,
        ...(profile.mtu !== null ? [`MTU = ${profile.mtu}`] : []),
        '',
        '[Peer]',
        `PublicKey = ${profile.publicKey}`,
        ...(profile.presharedKey !== null
            ? [`PreSharedKey = ${profile.presharedKey}`]
            : []),
        `Endpoint = ${profile.endpoint}`,
        `PersistentKeepalive = ${profile.persistentKeepalive || 25}`,
        '',
        '[Socks5]',
        `BindAddress = 127.0.0.1:${socksPort}`,
        '',
    ];
    return lines.join('\n');
}

/** What the tunnel process needs in its environment for that configuration. */
export function tunnelEnvironment(profile: VpnProfile): Record<string, string> {
    return { [VPN_PRIVATE_KEY_ENV]: profile.privateKey };
}
