import { useState } from 'preact/hooks';
import { desktopMpvAvailable } from '@meddl/tv/data-access';
import { t } from '@meddl/tv/util';

const STORAGE_KEY = 'meddl-app-player';

/** True in the Windows app (MPV) and the Android TV / Fire TV app (native player). */
export function appPlayerAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const android = (window as unknown as { MeddlAndroid?: { playNative?: unknown } }).MeddlAndroid;
    return typeof android?.playNative === 'function' || desktopMpvAvailable();
}

/**
 * Films and series start in the app's own player right away (on by
 * default), like TiviMate or VLC. Off: the page's player starts first and
 * hands over only for Dolby / DTS sound or streams it cannot play.
 */
export function alwaysAppPlayer(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
        return true;
    }
}

export function AppPlayerSetting() {
    const [on, setOn] = useState(alwaysAppPlayer());
    return (
        <section class="app-player-setting">
            <label class="check">
                <input
                    type="checkbox"
                    data-focus="settings:app-player"
                    checked={on}
                    onChange={(event) => {
                        const next = event.currentTarget.checked;
                        try {
                            localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
                        } catch {
                            // Applies for this session only.
                        }
                        setOn(next);
                    }}
                />
                <span>{t('Always use the meddl player')}</span>
            </label>
            <p class="muted">
                {t('Films, series and live TV in full screen start in the app’s own player, which plays Dolby / DTS sound and every stream format. Off: it takes over only when needed.')}
            </p>
        </section>
    );
}
