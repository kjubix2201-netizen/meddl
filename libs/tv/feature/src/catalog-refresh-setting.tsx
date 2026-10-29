import { useState } from 'preact/hooks';
import {
    CATALOG_REFRESH_CHOICES,
    catalogRefreshHours,
    clearCatalogCache,
    setCatalogRefreshHours,
} from '@meddl/tv/data-access';
import { t } from '@meddl/tv/util';

/**
 * Settings → Library: how often the full channel, film and series lists
 * are downloaded again (catalog-cache.ts), and a button to do it now.
 */
export function CatalogRefreshSetting() {
    const [hours, setHours] = useState(catalogRefreshHours());
    const [busy, setBusy] = useState(false);
    const label = (value: number) =>
        value === 0 ? t('On every start') : value === 24 ? t('Every 24 hours') : t('Every {hours} hours', { hours: value });
    return (
        <section class="catalog-refresh">
            <h2>{t('Channel and title lists')}</h2>
            <p class="muted">
                {t('meddl keeps the lists of your source on this device and downloads them again only after this time. If the provider does not answer, the last lists are used.')}
            </p>
            <label>
                {t('Download again')}
                <select
                    data-focus="settings:catalog-refresh"
                    value={String(hours)}
                    onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        setCatalogRefreshHours(next);
                        setHours(next);
                    }}
                >
                    {CATALOG_REFRESH_CHOICES.map((value) => (
                        <option value={String(value)}>{label(value)}</option>
                    ))}
                </select>
            </label>
            <button
                type="button"
                data-focus="settings:catalog-reload"
                disabled={busy}
                onClick={() => {
                    setBusy(true);
                    void clearCatalogCache().finally(() => location.reload());
                }}
            >
                {busy ? t('Loading…') : t('Reload lists now')}
            </button>
        </section>
    );
}
