import {
    SourceDraft,
    SettingsDraft,
    SetupPurpose,
    PhoneSettingsDefaults,
} from '@meddl/tv/util';
import { backendJson } from './backend';
export interface PairingSession {
    id: string;
    tvToken: string;
    phoneToken: string;
    expiresAt: number;
}
export interface PairingState {
    status: 'waiting' | 'pending' | 'saved' | 'rejected' | 'cancelled';
    source?: SourceDraft;
    purpose?: SetupPurpose;
    settings?: SettingsDraft;
    expiresAt: number;
}
export function createPairing(
    backend: string,
    accessToken: string,
    signal: AbortSignal,
    purpose: SetupPurpose = 'source',
    defaults?: PhoneSettingsDefaults
): Promise<PairingSession> {
    return backendJson(`${backend}/tv/pairing`, signal, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ purpose, defaults }),
    });
}
export function pairingState(
    backend: string,
    session: PairingSession,
    signal: AbortSignal
): Promise<PairingState> {
    return backendJson(`${backend}/tv/pairing/${session.id}/tv`, signal, {
        headers: { 'X-TV-Pairing': session.tvToken },
    });
}
export function finishPairing(
    backend: string,
    session: PairingSession,
    outcome: 'saved' | 'rejected' | 'cancelled',
    signal: AbortSignal
) {
    return backendJson(`${backend}/tv/pairing/${session.id}/tv`, signal, {
        method: 'POST',
        headers: {
            'X-TV-Pairing': session.tvToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outcome }),
    });
}

/**
 * Phone setup without a meddl server: the Android TV / Fire TV app and the
 * Windows app run their own small setup server in the home network. Its address for this page, or
 * "" when the app has none (other platforms, older app versions).
 */
type PairingShells = {
    MeddlAndroid?: { startPairingServer?: () => string };
    meddlDesktop?: { startPairingServer?: () => Promise<string> };
};

export async function appPairingServer(): Promise<string> {
    if (typeof window === 'undefined') return '';
    const { MeddlAndroid: android, meddlDesktop: desktop } = window as unknown as PairingShells;
    try {
        if (typeof android?.startPairingServer === 'function') return android.startPairingServer() || '';
        if (typeof desktop?.startPairingServer === 'function') return (await desktop.startPairingServer()) || '';
    } catch {
        // No setup server then.
    }
    return '';
}

/** True when the app itself can run the phone setup (Android TV, Windows app). */
export function appPairingAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const { MeddlAndroid: android, meddlDesktop: desktop } = window as unknown as PairingShells;
    return typeof android?.startPairingServer === 'function' || typeof desktop?.startPairingServer === 'function';
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

/**
 * Address for the phone setup QR code. A phone cannot open "localhost" (that
 * is the phone itself), so a loopback backend address is replaced with the
 * server's home-network address it reports in /tv/connection.
 */
export async function phoneBackendUrl(backend: string, signal: AbortSignal): Promise<string> {
    let url: URL;
    try {
        url = new URL(backend);
    } catch {
        return backend;
    }
    if (!LOOPBACK.test(url.hostname)) return backend;
    try {
        const info = (await backendJson(`${backend.replace(/\/$/, '')}/tv/connection`, signal)) as {
            addresses?: unknown;
        };
        const address = Array.isArray(info.addresses)
            ? info.addresses.find((a): a is string => typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a))
            : undefined;
        if (!address) return backend;
        url.hostname = address;
        return url.href.replace(/\/$/, '');
    } catch {
        return backend;
    }
}
