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
import { vpnConnected, vpnControl, type VpnState } from './vpn-shell';

export { vpnAvailable, vpnReady } from './vpn-shell';

/**
 * What to tell the viewer when a request to the source failed. With the VPN
 * connected the likely reason is the VPN itself: many providers refuse VPN
 * addresses, or tie an account to the home connection, and then simply do
 * not answer through the tunnel. Saying "check your source" would send the
 * viewer looking in the wrong place.
 */
export function requestFailureText(message: string): string {
    return vpnConnected()
        ? t('Your provider does not answer through the VPN. Many providers block VPN addresses or tie the account to your home connection. Choose another VPN server, or turn the VPN off (Settings → Connection → VPN).')
        : message;
}

/** A WireGuard file is small; more than this is something else. */
const PROFILE_MAX_LENGTH = 8000;

export function vpnErrorText(code: string): string {
    return errorText(code);
}

function errorText(code: string): string {
    if (code === 'vpn_not_authorized') return t('The TV did not allow the VPN. Connect again and choose “OK”.');
    if (code === 'invalid') return t('This is not a valid WireGuard file.');
    if (code === 'dns_resolution_failure') return t('The VPN server could not be found. Check the internet connection or use a newer profile.');
    if (code === 'unavailable') return t('This version of meddl has no built-in VPN.');
    return t('The VPN could not connect. Try again or use a new profile from your provider.');
}

/**
 * Settings → Connection: meddl's own traffic through the viewer's
 * WireGuard profile (Proton VPN Free, Mullvad, Surfshark …). On Android TV
 * the profile arrives from the phone by QR code, like a source; in the
 * desktop app it is chosen as a file on the computer.
 */
export function VpnSetting() {
    const control = vpnControl();
    const [vpn, setVpn] = useState<VpnState | undefined>(() => control?.current());
    const [session, setSession] = useState<PairingSession>();
    const [qr, setQr] = useState('');
    const [incoming, setIncoming] = useState<{ config: string; name: string }>();
    const [notice, setNotice] = useState('');
    const server = useRef('');
    const sessionRef = useRef<PairingSession>();
    const operation = useRef<AbortController>();
    const file = useRef<HTMLInputElement>(null);

    // Every change of the VPN arrives from the app.
    useEffect(() => {
        if (!control) return;
        const stop = control.subscribe(setVpn);
        void control.refresh().then((state) => state && setVpn(state));
        return stop;
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

    /** Saves a profile; true when the app took it. */
    async function save(config: string, name: string) {
        const problem = (await control?.importProfile(config, name)) ?? 'invalid';
        if (problem) {
            setNotice(errorText(problem));
            return false;
        }
        const state = await control?.refresh();
        if (state) setVpn(state);
        setNotice(t('Profile saved. Connect to use the VPN.'));
        restoreFocus('vpn:toggle');
        return true;
    }

    async function accept() {
        if (!incoming) return;
        close((await save(incoming.config, incoming.name)) ? 'saved' : 'rejected');
    }

    /** Desktop: the WireGuard file, chosen on this computer. */
    async function chooseFile(input: HTMLInputElement) {
        const picked = input.files?.[0];
        // The same file can be chosen again after a correction.
        input.value = '';
        if (!picked) return;
        setNotice('');
        const text = await picked.text().catch(() => '');
        if (!text || text.length > PROFILE_MAX_LENGTH) {
            setNotice(errorText('invalid'));
            return;
        }
        await save(text, picked.name.replace(/\.conf$/i, '').slice(0, 60));
    }

    // The desktop bridge also exists in builds without the tunnel program.
    if (!control || !vpn || (control.source === 'file' && !vpn.available)) return null;
    const byFile = control.source === 'file';
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
                {byFile
                    ? t('meddl’s connection runs encrypted through your own VPN provider (a WireGuard profile, for example from Proton VPN Free). Only meddl uses this VPN; other programs on this computer stay as they are.')
                    : t('meddl’s connection runs encrypted through your own VPN provider (a WireGuard profile, for example from Proton VPN Free). Only meddl uses this VPN; other apps on the TV stay as they are.')}
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
                        <button class="primary" data-focus="vpn:accept" onClick={() => void accept()}>
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
                            onClick={() => (connected ? control.disconnect() : control.connect())}
                        >
                            {connected ? t('Disconnect') : t('Connect')}
                        </button>
                    ) : null}
                    {byFile ? (
                        <>
                            <input
                                ref={file}
                                type="file"
                                accept=".conf,text/plain"
                                hidden
                                onChange={(event) => void chooseFile(event.currentTarget)}
                            />
                            <button data-focus="vpn:file" onClick={() => file.current?.click()}>
                                {vpn.configured ? t('Replace WireGuard file') : t('Choose WireGuard file')}
                            </button>
                        </>
                    ) : (
                        <button data-focus="vpn:phone" onClick={() => void startPhone()}>
                            {vpn.configured ? t('Replace profile by phone') : t('Add profile by phone')}
                        </button>
                    )}
                    {vpn.configured ? (
                        <button data-focus="vpn:remove" onClick={() => control.remove()}>
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
                            onChange={(event) => control.setLock(event.currentTarget.checked)}
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
                            onChange={(event) => control.setAutostart(event.currentTarget.checked)}
                        />
                        <span>{t('Connect automatically when meddl starts')}</span>
                    </label>
                </>
            ) : null}
        </section>
    );
}
