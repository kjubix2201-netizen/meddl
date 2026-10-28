import QRCode from 'qrcode';
import { useEffect, useState } from 'preact/hooks';
import { t } from '@meddl/tv/util';

interface HomeNetworkStatus {
    enabled: boolean;
    port: number;
    addresses: string[];
    error?: string;
}
type DesktopShell = {
    homeNetworkStatus?: () => Promise<HomeNetworkStatus>;
    setHomeNetwork?: (enabled: boolean) => Promise<HomeNetworkStatus>;
};

function desktop(): DesktopShell | undefined {
    return (window as unknown as { meddlDesktop?: DesktopShell }).meddlDesktop;
}

/** True in the desktop app, which can share meddl in the home network. */
export function homeNetworkSharingAvailable(): boolean {
    return typeof desktop()?.setHomeNetwork === 'function';
}

/**
 * Settings → Connection in the desktop app: shares meddl in the home
 * network, so an iPhone (or any phone or tablet) opens it in the browser
 * and keeps it on the home screen. The computer then works as the server.
 */
export function HomeNetworkSetting() {
    const [status, setStatus] = useState<HomeNetworkStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [qr, setQr] = useState('');
    const address = status?.enabled && status.addresses[0] ? `http://${status.addresses[0]}:${status.port}` : '';

    useEffect(() => {
        desktop()
            ?.homeNetworkStatus?.()
            .then(setStatus)
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        if (!address) return setQr('');
        let current = true;
        QRCode.toDataURL(address, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
            .then((url: string) => current && setQr(url))
            .catch(() => current && setQr(''));
        return () => {
            current = false;
        };
    }, [address]);

    async function toggle() {
        const shell = desktop();
        if (!shell?.setHomeNetwork || busy) return;
        setBusy(true);
        try {
            setStatus(await shell.setHomeNetwork(!status?.enabled));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section class="home-network">
            <h2>{t('iPhone and phones')}</h2>
            <p class="muted">
                {t('Share meddl in your home network. Phones and tablets then open it in the browser, with this computer as the server.')}
            </p>
            <label class="check">
                <input
                    type="checkbox"
                    data-focus="settings:home-network"
                    checked={!!status?.enabled}
                    disabled={busy || !status}
                    onChange={() => void toggle()}
                />
                <span>{t('Share in the home network')}</span>
            </label>
            {status?.error ? <p class="error">{t('Sharing could not start: {reason}', { reason: status.error })}</p> : null}
            {status?.enabled && !address ? (
                <p class="muted">{t('This computer is not connected to a home network.')}</p>
            ) : null}
            {address ? (
                <div class="home-network-share">
                    {qr ? <img class="pairing-qr" src={qr} alt={t('QR code with the address of meddl')} /> : null}
                    <div>
                        <p>
                            {t('On the iPhone, open this address in Safari:')} <strong>{address}</strong>
                        </p>
                        <ol class="muted">
                            <li>{t('Scan the QR code with the camera or type the address.')}</li>
                            <li>{t('Tap Share, then "Add to Home Screen".')}</li>
                            <li>{t('Add your source once on the iPhone. It works while this computer runs meddl and the iPhone is in the same Wi-Fi.')}</li>
                        </ol>
                        <p class="muted">
                            {t('If Windows asks, allow meddl in private networks.')}
                        </p>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
