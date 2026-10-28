import { useState } from 'preact/hooks';
import {
    findWeatherPlace,
    savedWeatherPlace,
    saveWeatherPlace,
} from '@meddl/tv/data-access';
import { t, tvLanguage } from '@meddl/tv/util';

/** Town for the weather next to the Home clock; empty hides the weather. */
export function WeatherSetting() {
    const [query, setQuery] = useState(() => savedWeatherPlace()?.name ?? '');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async (event: SubmitEvent) => {
        event.preventDefault();
        const name = query.trim();
        if (!name) {
            saveWeatherPlace(undefined);
            setStatus(t('Weather hidden on Home.'));
            return;
        }
        setBusy(true);
        setStatus('');
        try {
            const place = await findWeatherPlace(name, tvLanguage());
            if (!place) {
                setStatus(t('Place not found.'));
                return;
            }
            saveWeatherPlace(place);
            setQuery(place.name);
            setStatus(t('Location saved: {place}', { place: place.name }));
        } catch {
            setStatus(t('The weather service is not reachable right now.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <form class="source-form weather-setting" onSubmit={(e) => void save(e)}>
            <label>
                {t('Weather location')}
                <input
                    type="text"
                    data-focus="settings:weather:value"
                    placeholder={t('e.g. Berlin')}
                    value={query}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                />
            </label>
            <p class="muted">
                {t('Shown on Home next to the clock. Leave empty to hide the weather.')}
            </p>
            <button class="primary" disabled={busy} data-focus="settings:weather:save">
                {busy ? t('Saving…') : t('Save location')}
            </button>
            {status ? <p role="status">{status}</p> : null}
        </form>
    );
}
