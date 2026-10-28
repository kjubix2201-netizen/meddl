import { t } from '@meddl/tv/util';
import type { PairingState } from '@meddl/tv/data-access';
export function PhoneReview({
    state,
    busy,
    remaining,
    saved,
    confirm,
    decline,
}: {
    state: PairingState;
    busy: boolean;
    remaining: number;
    saved: boolean;
    confirm: () => void;
    decline: () => void;
}) {
    const isSettings = !!state.settings;
    return (
        <div class="phone-review">
            <p class="eyebrow">{t('RECEIVED FROM YOUR PHONE')}</p>
            <h3>{isSettings ? t('TV settings') : state.source!.name}</h3>
            <p>
                {isSettings
                    ? `TMDB ${state.settings!.tmdb.enabled ? 'on' : 'off'} · ${state.settings!.tmdb.language.toUpperCase()} · ${state.settings!.layout === 'cinema' ? t('Cinema') : t('Showcase')} · EPG ${state.settings!.epg ? 'on' : 'off'}`
                    : `${state.source!.provider.toUpperCase()} · ${new URL(state.source!.url).hostname}`}
            </p>
            <p class="muted">
                {isSettings
                    ? t('Apply these settings? TMDB key: {choice}.', { choice: state.settings!.tmdb.apiKey ? t('replace with the key from your phone') : t('keep existing') })
                    : t('Add this source to your TV?')}
            </p>
            <div class="actions">
                <button
                    type="button"
                    class="primary"
                    data-focus="phone-confirm"
                    disabled={busy || !remaining}
                    onClick={() => confirm()}
                >
                    {busy
                        ? t('Saving…')
                        : saved
                          ? t('Retry confirmation')
                          : isSettings
                            ? t('Apply settings')
                            : t('Add source')}
                </button>
                <button
                    type="button"
                    disabled={busy || saved}
                    onClick={() => decline()}
                >
                    {t('Decline')}
                </button>
            </div>
        </div>
    );
}
