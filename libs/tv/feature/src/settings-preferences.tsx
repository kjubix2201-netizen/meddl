import { t } from '@meddl/tv/util';
import { useEffect, useState } from 'preact/hooks';
import type { TvModel } from './use-tv';
import { APP_THEMES, chooseTheme, savedTheme } from './app-theme';

/** Design swatches: chosen right away, without saving. */
function ThemePicker() {
    const [current, setCurrent] = useState(savedTheme());
    return (
        <fieldset class="theme-picker">
            <legend>{t('Design')}</legend>
            <div class="theme-swatches">
                {APP_THEMES.map((theme) => (
                    <button
                        type="button"
                        class={`theme-swatch ${current === theme.id ? 'is-current' : ''}`}
                        data-focus={`settings:theme:${theme.id}`}
                        aria-pressed={current === theme.id}
                        onClick={() => {
                            chooseTheme(theme.id);
                            setCurrent(theme.id);
                        }}
                    >
                        <span
                            class="theme-swatch-preview"
                            aria-hidden="true"
                            style={{
                                background: `linear-gradient(135deg, ${theme.preview[1]} 0%, ${theme.preview[0]} 55%, ${theme.preview[2]} 100%)`,
                            }}
                        >
                            <i />
                            <i />
                        </span>
                        <span class="theme-swatch-name">{t(theme.name)}</span>
                    </button>
                ))}
            </div>
        </fieldset>
    );
}

// Each form owns one persisted field. Saving one category must never commit
// another category's draft, including after a phone settings update.
export function SettingsPreferences({
    tv,
    field,
}: {
    tv: TvModel;
    field: 'layout' | 'epg';
}) {
    const persisted = tv.data[field];
    const [value, setValue] = useState(persisted);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setValue(persisted);
    }, [persisted]);
    const save = (event: SubmitEvent) => {
        event.preventDefault();
        const draft = value;
        const persist = async () => {
            setSaving(true);
            try {
                await tv.update((data) =>
                    field === 'layout'
                        ? {
                              ...data,
                              layout: draft === 'shelf' ? 'shelf' : 'cinema',
                          }
                        : { ...data, epg: draft === true }
                );
                setSaved(true);
                tv.setError('');
            } catch {
                tv.setError(
                    t('Settings could not be saved.'),
                    () => void persist(),
                    t('Retry saving settings')
                );
            } finally {
                setSaving(false);
            }
        };
        setSaved(false);
        void persist();
    };
    return (
        <form class="source-form" onSubmit={save}>
            <h2>{field === 'layout' ? t('Appearance') : t('Programme guide')}</h2>
            <p class="muted">
                {field === 'layout'
                    ? t('Choose the design and how titles appear on Home.')
                    : t('Show programme information supplied by your TV provider.')}
            </p>
            {field === 'layout' ? <ThemePicker /> : null}
            {field === 'layout' ? (
                <label>
                    {t('Home composition')}
                    <select
                        name="layout"
                        data-focus="settings:layout:value"
                        value={String(value)}
                        onChange={(event) => {
                            setValue(
                                event.currentTarget.value === 'shelf'
                                    ? 'shelf'
                                    : 'cinema'
                            );
                            setSaved(false);
                        }}
                    >
                        <option value="cinema">{t('Кинозал · Cinema')}</option>
                        <option value="shelf">{t('Витрина · Showcase')}</option>
                    </select>
                </label>
            ) : (
                <label class="check">
                    <input
                        type="checkbox"
                        name="epg"
                        data-focus="settings:epg:value"
                        checked={value === true}
                        onChange={(event) => {
                            setValue(event.currentTarget.checked);
                            setSaved(false);
                        }}
                    />
                    {t('Show provider programme guide')}
                </label>
            )}
            <button
                class="primary"
                disabled={saving}
                data-focus={`settings:${field}:save`}
            >
                {saving ? t('Saving…') : t('Save settings')}
            </button>
            {saved ? <p role="status">{t('Settings saved on this TV.')}</p> : null}
        </form>
    );
}
