import { t } from '@meddl/tv/util';
import { useEffect, useRef, useState } from 'preact/hooks';
import { checkTmdbKey } from '@meddl/tv/data-access';
import { TvModel } from './use-tv';

export function TmdbSettings({ tv }: { tv: TvModel }) {
    const [key, setKey] = useState(tv.data.tmdb.apiKey);
    const [enabled, setEnabled] = useState(tv.data.tmdb.enabled);
    const [language, setLanguage] = useState(tv.data.tmdb.language);
    const [status, setStatus] = useState('');
    const [checking, setChecking] = useState(false);
    const [saving, setSaving] = useState(false);
    const request = useRef<AbortController>();
    const dirty =
        enabled !== tv.data.tmdb.enabled ||
        key.trim() !== tv.data.tmdb.apiKey ||
        language !== tv.data.tmdb.language;
    useEffect(() => {
        request.current?.abort();
        setChecking(false);
        setKey(tv.data.tmdb.apiKey);
        setEnabled(tv.data.tmdb.enabled);
        setLanguage(tv.data.tmdb.language);
    }, [tv.data.tmdb.apiKey, tv.data.tmdb.enabled, tv.data.tmdb.language]);
    useEffect(() => () => request.current?.abort(), []);
    const check = async () => {
        request.current?.abort();
        const abort = new AbortController();
        request.current = abort;
        setChecking(true);
        setStatus('');
        const valid = await checkTmdbKey(key, abort.signal);
        if (!abort.signal.aborted) {
            setStatus(
                valid
                    ? `TMDB key is valid.${!tv.data.tmdb.enabled ? ' ' + t('Metadata is disabled. Enable it and save to use enrichment.') : dirty ? ' ' + t('Save your changes to use this key and language.') : ''}`
                    : t('TMDB could not validate this key. Check the key and connection.')
            );
            setChecking(false);
        }
    };
    const save = async (event: SubmitEvent) => {
        event.preventDefault();
        setSaving(true);
        try {
            await tv.update((data) => ({
                ...data,
                tmdb: { enabled, apiKey: key.trim(), language },
            }));
            setStatus(
                enabled
                    ? t('TMDB settings saved on this TV. Metadata is enabled.')
                    : t('TMDB settings saved on this TV. Metadata is disabled.')
            );
        } catch {
            setStatus(
                t('TMDB settings were not saved. Free TV storage and retry.')
            );
        } finally {
            setSaving(false);
        }
    };
    return (
        <section class="tmdb-settings">
            <h2>{t('Metadata · TMDB')}</h2>
            <p class="muted">
                {t('Add movie and series artwork, descriptions, cast and episode information. When enabled, title searches go directly to TMDB. Playback stays with your provider.')}
            </p>
            <p class="tmdb-state" aria-live="polite">
                Metadata is {tv.data.tmdb.enabled ? 'enabled' : 'disabled'} on
                this TV.
                {dirty
                    ? ' ' + t('Unsaved changes: choose Save TMDB settings to apply.')
                    : ''}
            </p>
            <form class="source-form" onSubmit={save}>
                <label class="check">
                    <input
                        type="checkbox"
                        data-focus="tmdb:enabled"
                        checked={enabled}
                        onChange={(event) =>
                            setEnabled(event.currentTarget.checked)
                        }
                    />
                    {t('Use TMDB metadata')}
                </label>
                <label>
                    {t('TMDB API key or read access token')}
                    <input
                        type="password"
                        name="tmdb-key"
                        data-focus="tmdb:key"
                        autoComplete="off"
                        required={enabled}
                        value={key}
                        onInput={(event) => {
                            request.current?.abort();
                            setChecking(false);
                            setStatus('');
                            setKey(event.currentTarget.value);
                        }}
                    />
                </label>
                <label>
                    {t('Metadata language')}
                    <select
                        data-focus="tmdb:language"
                        value={language}
                        onChange={(event) =>
                            setLanguage(event.currentTarget.value)
                        }
                    >
                        {[
                            ['en', 'English'],
                            ['ru', 'Русский'],
                            ['de', 'Deutsch'],
                            ['uk', 'Українська'],
                            ['fr', 'Français'],
                            ['es', 'Español'],
                            ['it', 'Italiano'],
                        ].map(([value, title]) => (
                            <option value={value}>{title}</option>
                        ))}
                    </select>
                </label>
                <div class="actions">
                    <button
                        type="button"
                        data-focus="tmdb:check"
                        disabled={!key.trim() || checking}
                        onClick={check}
                    >
                        {checking ? t('Checking…') : t('Check TMDB key')}
                    </button>
                    <button
                        class="primary"
                        disabled={saving}
                        data-focus="tmdb:save"
                    >
                        {saving ? t('Saving…') : t('Save TMDB settings')}
                    </button>
                </div>
                {status ? <p role="status">{status}</p> : null}
            </form>
            <div class="tmdb-attribution">
                <img src="./tmdb-logo.svg" alt="TMDB" />
                <p>
                    {t('This product uses the TMDB API but is not endorsed or certified by TMDB.')}
                </p>
            </div>
        </section>
    );
}
