import { setTvLanguage, t, tvLanguage, type TvLanguage } from '@meddl/tv/util';

const LANGUAGES: [TvLanguage, string][] = [
    ['de', 'Deutsch'],
    ['en', 'English'],
];

/**
 * Interface language. Texts are looked up when rendered, so the page reloads
 * once after a change; saved data, sources and the position are kept.
 */
export function LanguageSetting() {
    return (
        <label class="language-setting">
            {t('Language')} · Language
            <select
                data-focus="settings:language:value"
                value={tvLanguage()}
                onChange={(event) => {
                    const next = event.currentTarget.value as TvLanguage;
                    if (next === tvLanguage()) return;
                    setTvLanguage(next);
                    location.reload();
                }}
            >
                {LANGUAGES.map(([value, label]) => (
                    <option value={value}>{label}</option>
                ))}
            </select>
        </label>
    );
}
