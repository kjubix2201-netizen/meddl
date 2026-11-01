import { useEffect, useRef, useState } from 'preact/hooks';
import { focusKey, restoreFocus } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import { directFetch, iosApp, localServerAvailable } from '@meddl/tv/data-access';
import type { TvModel } from './use-tv';

declare const __MEDDL_BUILD__: string;

/** The public update channel (tools/ci/publish-updates.sh). */
const CHANNEL = 'https://github.com/kjubix2201-netizen/meddl-updates/releases/download/latest/';
const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

type Platform = 'android' | 'windows' | 'ios';
type Update = { build: number; url: string; size?: number };
type InstallState = 'idle' | 'downloading' | 'installing' | 'permission' | 'failed' | 'opened';

type Shell = {
    MeddlAndroid?: { installUpdate?: (url: string) => void; playNative?: unknown };
    meddlDesktop?: unknown;
    meddlUpdateProgress?: (percent: number) => void;
    meddlUpdateResult?: (state: string) => void;
};

function currentBuild(): number {
    const build = typeof __MEDDL_BUILD__ === 'string' ? Number(__MEDDL_BUILD__) : 0;
    return Number.isFinite(build) ? build : 0;
}

function platform(): Platform | undefined {
    const shell = window as unknown as Shell;
    if (shell.MeddlAndroid) return 'android';
    if (iosApp()) return 'ios';
    if (shell.meddlDesktop) return 'windows';
    return undefined;
}

async function check(target: Platform, signal: AbortSignal): Promise<Update | undefined> {
    const answer = await directFetch(`${CHANNEL}${target}.json?t=${Date.now()}`, {}, signal, 15_000);
    if (answer.status !== 200) return undefined;
    const data = JSON.parse(answer.text) as Partial<Update>;
    if (typeof data.build !== 'number' || typeof data.url !== 'string' || !data.url.startsWith(CHANNEL))
        return undefined;
    return { build: data.build, url: data.url, ...(typeof data.size === 'number' ? { size: data.size } : {}) };
}

/**
 * "New version available": the meddl apps (Android TV / Fire TV, Windows,
 * iPhone) look on the update channel at the start and every 6 hours. Only
 * CI builds know their build number; local builds never ask.
 */
function useUpdateCheck() {
    const [update, setUpdate] = useState<Update>();
    useEffect(() => {
        const target = platform();
        const build = currentBuild();
        if (!target || !build || !localServerAvailable()) return;
        const abort = new AbortController();
        const run = () =>
            void check(target, abort.signal)
                .then((found) => {
                    if (found && found.build > build) setUpdate(found);
                })
                .catch(() => undefined);
        const first = setTimeout(run, FIRST_CHECK_MS);
        const later = setInterval(run, CHECK_EVERY_MS);
        return () => {
            abort.abort();
            clearTimeout(first);
            clearInterval(later);
        };
    }, []);
    return update;
}

/**
 * The notice itself: a small window on the home screen, never over the
 * player or the loading window. "Later" hides it until the next start.
 */
export function UpdateNotice({ tv }: { tv: TvModel }) {
    const update = useUpdateCheck();
    const [later, setLater] = useState(0);
    const [state, setState] = useState<InstallState>('idle');
    const [percent, setPercent] = useState(0);
    const panel = useRef<HTMLDivElement>(null);
    const previous = useRef('');
    const target = platform();
    const open = !!update && later !== update.build && !tv.playing && tv.storageReady && tv.warm.phase === 'idle';

    useEffect(() => {
        const shell = window as unknown as Shell;
        shell.meddlUpdateProgress = (value) => {
            setState('downloading');
            setPercent(value);
        };
        shell.meddlUpdateResult = (value) =>
            setState(value === 'installing' || value === 'permission' ? value : 'failed');
        return () => {
            delete shell.meddlUpdateProgress;
            delete shell.meddlUpdateResult;
        };
    }, []);
    useEffect(() => {
        if (!open) return;
        previous.current = focusKey();
        restoreFocus('update:install');
        return () => restoreFocus(previous.current || 'launcher:live', 'launcher:live');
    }, [open]);
    if (!open || !update) return null;

    const install = () => {
        const android = (window as unknown as Shell).MeddlAndroid;
        if (target === 'android' && android?.installUpdate) {
            setState('downloading');
            setPercent(0);
            android.installUpdate(update.url);
            return;
        }
        // Windows: the browser downloads the installer; iPhone: Sideloadly.
        window.open(target === 'ios' ? update.url.replace(/\/download\/latest\/.*$/, '/tag/latest') : update.url, '_blank');
        setState('opened');
    };
    const size = update.size ? ` · ${Math.round(update.size / 1_000_000)} MB` : '';
    const busy = state === 'downloading';
    return (
        <div class="loading-overlay update-notice" data-tv-modal role="dialog" aria-modal="true" aria-labelledby="update-title">
            <div class="loading-panel" ref={panel} tabIndex={-1}>
                <h2 id="update-title">{t('New version available')}</h2>
                <p class="muted">
                    {t('Build {build}', { build: update.build })}
                    {size}
                </p>
                <p class="muted">
                    {state === 'downloading'
                        ? t('Downloading… {percent} %', { percent })
                        : state === 'installing'
                          ? t('Confirm the installation. meddl starts again afterwards with your sources and settings.')
                          : state === 'permission'
                            ? t('Allow meddl to install apps (“Install unknown apps”), come back and choose Install again.')
                            : state === 'failed'
                              ? t('The download did not work. Try again later.')
                              : state === 'opened'
                                ? target === 'ios'
                                    ? t('Install the new IPA with Sideloadly, like the first time.')
                                    : t('Run the downloaded installer. Your sources and settings stay.')
                                : target === 'android'
                                  ? t('meddl downloads the update and opens the installer. Your sources and settings stay.')
                                  : target === 'ios'
                                    ? t('Opens the download page. Install the new IPA with Sideloadly.')
                                    : t('Downloads the new installer. Your sources and settings stay.')}
                </p>
                {busy ? (
                    <div class="loading-progress" aria-hidden="true">
                        <span style={{ width: `${Math.max(4, percent)}%` }} />
                    </div>
                ) : null}
                <div class="update-actions">
                    <button class="primary" data-focus="update:install" disabled={busy} onClick={install}>
                        {target === 'android' ? t('Install') : t('Download')}
                    </button>
                    <button data-focus="update:later" disabled={busy} onClick={() => setLater(update.build)}>
                        {t('Later')}
                    </button>
                </div>
            </div>
        </div>
    );
}
