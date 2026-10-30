import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
    appPairingServer,
    createPairing,
    finishPairing,
    pairingState,
    phoneBackendUrl,
    type PairingSession,
} from '@meddl/tv/data-access';
import { t } from '@meddl/tv/util';
import { restoreFocus } from '@meddl/tv/ui';

/** What the Android TV app's built-in VPN reports (MeddlVpn.kt). */
interface VpnState {
    available: boolean;
    configured: boolean;
    state: 'down' | 'connecting' | 'up';
    error: string;
    autostart: boolean;
    /** Only through the VPN: meddl waits for the tunnel before loading. */
    lock: boolean;
    name: string;
    server?: string;
}
type VpnShell = {
    vpnState?: () => string;
    vpnImport?: (text: string, name: string) => string;
    vpnConnect?: () => void;
    vpnDisconnect?: () => void;
    vpnRemove?: () => void;
    vpnSetAutostart?: (on: boolean) => void;
    vpnSetLock?: (on: boolean) => void;
};

function shell(): VpnShell | undefined {
    return (window as unknown as { MeddlAndroid?: VpnShell }).MeddlAndroid;
}

/** True in the Android TV / Fire TV app with the built-in VPN. */
export function vpnAvailable(): boolean {
    return typeof shell()?.vpnState === 'function';
}

function readState(): VpnState | undefined {
    try {
        return JSON.parse(shell()?.vpnState?.() ?? '') as VpnState;
    } catch {
        return undefined;
    }
}

/**
 * With "only through the VPN" on: resolves once the tunnel is up (and
 * starts it when needed, asking the TV for permission the first time).
 * Resolves at once without the lock, or when the viewer turns it off.
 */
export async function vpnReady(signal: AbortSignal, waiting: (error: string) => void): Promise<void> {
    let state = readState();
    if (!state?.lock || !state.configured || state.state === 'up') return;
    if (state.state === 'down') shell()?.vpnConnect?.();
    waiting('');
    let asked = Date.now();
    while (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = readState();
        if (!state?.lock || !state.configured || state.state === 'up') return;
        waiting(state.error);
        // Dropped or refused: try again every 15 s (the viewer may fix it meanwhile).
        if (state.state === 'down' && Date.now() - asked > 15000) {
            asked = Date.now();
            shell()?.vpnConnect?.();
        }
    }
    throw new DOMException('Aborted', 'AbortError');
}

export function vpnErrorText(code: string): string {
    return errorText(code);
}

function errorText(code: string): string {
    if (!code) return '';
    if (code === 'vpn_not_authorized') return t('The TV did not allow the VPN. Connect again and choose “OK”.');
    if (code === 'invalid') return t('This is not a valid WireGuard file.');
    if (code === 'dns_resolution_failure') return t('The VPN server could not be found. Check the internet connection or use a newer profile.');
    return t('The VPN could not connect. Try again or use a new profile from your provider.');
}

/**
 * Settings → Connection on Android TV: meddl's own traffic through the
 * viewer's WireGuard profile (Proton VPN Free, Mullvad, Surfshark …). The
 * profile arrives from the phone by QR code, like a source.
 */
export function VpnSetting() {
    const [vpn, setVpn] = useState<VpnState | undefined>(readState);
    const [session, setSession] = useState<PairingSession>();
    const [qr, setQr] = useState('');
    const [incoming, setIncoming] = useState<{ config: string; name: string }>();
    const [notice, setNotice] = useState('');
    const server = useRef('');
    const sessionRef = useRef<PairingSession>();
    const operation = useRef<AbortController>();

    // Every change of the VPN arrives from the app.
    useEffect(() => {
        const w = window as unknown as { meddlVpnChanged?: (state: VpnState) => void };
        w.meddlVpnChanged = (state) => setVpn(state);
        return () => {
            delete w.meddlVpnChanged;
        };
    }, []);
    useEffect(
        () => () => {
            operation.current?.abort();
        },
        []
    );

    function close(outcome: 'saved' | 'rejected' | 'cancelled') {
        operation.current?.abort();
        const current = sessionRef.current;
        sessionRef.current = undefined;
        if (current && server.current)
            void finishPairing(server.current, current, outcome, new AbortController().signal).catch(() => undefined);
        setSession(undefined);
        setQr('');
        setIncoming(undefined);
    }

    async function startPhone() {
        operation.current?.abort();
        const abort = new AbortController();
        operation.current = abort;
        setNotice('');
        try {
            const backend = await appPairingServer();
            if (!backend) throw new Error('No setup server');
            const next = await createPairing(backend, '', abort.signal, 'vpn');
            server.current = backend;
            sessionRef.current = next;
            const reachable = await phoneBackendUrl(backend, abort.signal);
            const url = `${reachable}/tv/setup#${next.id}.${next.phoneToken}`;
            setQr(await QRCode.toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' }));
            if (abort.signal.aborted) return;
            sessionRef.current = next;
            setSession(next);
            restoreFocus('vpn:cancel');
            // Wait for the phone.
            while (!abort.signal.aborted && Date.now() < next.expiresAt) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                if (abort.signal.aborted) return;
                const state = await pairingState(backend, next, abort.signal).catch(() => undefined);
                if (state?.status === 'pending' && state.vpn?.config) {
                    setIncoming({ config: state.vpn.config, name: state.vpn.name || t('VPN profile') });
                    restoreFocus('vpn:accept');
                    return;
                }
                if (state && ['cancelled', 'rejected', 'saved'].includes(state.status)) return;
            }
            if (!abort.signal.aborted) {
                setNotice(t('This QR code expired. Close it and create a new one.'));
                close('cancelled');
            }
        } catch {
            if (!abort.signal.aborted) setNotice(t('Phone setup could not start. Check the backend connection.'));
        }
    }

    function accept() {
        if (!incoming) return;
        const problem = shell()?.vpnImport?.(incoming.config, incoming.name) ?? 'invalid';
        if (problem) {
            setNotice(errorText(problem));
            close('rejected');
            return;
        }
        close('saved');
        setVpn(readState());
        setNotice(t('Profile saved. Connect to use the VPN.'));
        restoreFocus('vpn:toggle');
    }

    if (!vpn) return null;
    const connected = vpn.state === 'up';
    const status =
        vpn.state === 'up'
            ? t('Connected')
            : vpn.state === 'connecting'
              ? t('Connecting…')
              : vpn.configured
                ? t('Not connected')
                : t('No profile yet');
    return (
        <section class="vpn-setting">
            <h2>{t('VPN')}</h2>
            <p class="muted">
                {t('meddl’s connection runs encrypted through your own VPN provider (a WireGuard profile, for example from Proton VPN Free). Only meddl uses this VPN; other apps on the TV stay as they are.')}
            </p>
            <div class={`vpn-status is-${vpn.state}`} role="status">
                <span class="vpn-dot" aria-hidden="true" />
                <strong>{status}</strong>
                {vpn.configured ? (
                    <small>
                        {vpn.name || t('VPN profile')}
                        {vpn.server ? ` · ${vpn.server}` : ''}
                    </small>
                ) : null}
            </div>
            {vpn.error ? <p class="vpn-error">{errorText(vpn.error)}</p> : null}
            {notice ? <p class="muted">{notice}</p> : null}
            {incoming ? (
                <div class="vpn-incoming">
                    <p>
                        {t('Use the profile “{name}” from your phone?', { name: incoming.name })}
                    </p>
                    <div class="actions">
                        <button class="primary" data-focus="vpn:accept" onClick={accept}>
                            {t('Use profile')}
                        </button>
                        <button data-focus="vpn:reject" onClick={() => close('rejected')}>
                            {t('Decline')}
                        </button>
                    </div>
                </div>
            ) : session && qr ? (
                <div class="vpn-pairing">
                    <img class="pairing-qr" src={qr} alt={t('QR code for the phone setup')} />
                    <div>
                        <p>
                            {t('Scan with your phone, choose the WireGuard file from your VPN provider and send it.')}
                        </p>
                        <button data-focus="vpn:cancel" onClick={() => close('cancelled')}>
                            {t('Cancel')}
                        </button>
                    </div>
                </div>
            ) : (
                <div class="actions">
                    {vpn.configured ? (
                        <button
                            class="primary"
                            data-focus="vpn:toggle"
                            disabled={vpn.state === 'connecting'}
                            onClick={() => (connected ? shell()?.vpnDisconnect?.() : shell()?.vpnConnect?.())}
                        >
                            {connected ? t('Disconnect') : t('Connect')}
                        </button>
                    ) : null}
                    <button data-focus="vpn:phone" onClick={() => void startPhone()}>
                        {vpn.configured ? t('Replace profile by phone') : t('Add profile by phone')}
                    </button>
                    {vpn.configured ? (
                        <button data-focus="vpn:remove" onClick={() => shell()?.vpnRemove?.()}>
                            {t('Remove profile')}
                        </button>
                    ) : null}
                </div>
            )}
            {vpn.configured ? (
                <>
                    <label class="check">
                        <input
                            type="checkbox"
                            data-focus="vpn:lock"
                            checked={vpn.lock}
                            onChange={(event) => shell()?.vpnSetLock?.(event.currentTarget.checked)}
                        />
                        <span>{t('Only through the VPN (lock)')}</span>
                    </label>
                    <p class="muted vpn-note">
                        {t('meddl then loads channels, films and pictures only once the VPN is connected, and connects again by itself when the VPN drops.')}
                    </p>
                    <label class="check">
                        <input
                            type="checkbox"
                            data-focus="vpn:autostart"
                            checked={vpn.autostart}
                            disabled={vpn.lock}
                            onChange={(event) => shell()?.vpnSetAutostart?.(event.currentTarget.checked)}
                        />
                        <span>{t('Connect automatically when meddl starts')}</span>
                    </label>
                </>
            ) : null}
        </section>
    );
}
