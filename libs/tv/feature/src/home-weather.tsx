import { useEffect, useState } from 'preact/hooks';
import {
    currentWeather,
    savedWeatherPlace,
    type WeatherNow,
} from '@meddl/tv/data-access';
import { WeatherIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';

const REFRESH_MS = 20 * 60 * 1000;

/**
 * Temperature and sky above the Home clock. Shows nothing until a place is
 * set in Settings → Appearance, or while the weather service is unreachable.
 */
export function HomeWeather() {
    const [place] = useState(savedWeatherPlace);
    const [now, setNow] = useState<WeatherNow>();
    useEffect(() => {
        if (!place) return;
        let alive = true;
        const load = () =>
            currentWeather(place).then(
                (value) => alive && setNow(value),
                () => undefined
            );
        void load();
        const timer = setInterval(() => void load(), REFRESH_MS);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [place]);
    if (!place || !now) return null;
    return (
        <p
            class="home-weather"
            aria-label={t('{temperature}° in {place}', {
                temperature: now.temperature,
                place: place.name,
            })}
        >
            <WeatherIcon code={now.code} day={now.day} />
            <span>{now.temperature}°</span>
        </p>
    );
}
