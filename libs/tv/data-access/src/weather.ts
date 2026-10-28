/**
 * Current weather for the Home clock, from Open-Meteo (free, no API key,
 * CORS enabled). The place is chosen once in Settings → Appearance and saved
 * on this TV; nothing is requested while no place is set.
 */
export type WeatherPlace = { name: string; latitude: number; longitude: number };
export type WeatherNow = {
    temperature: number;
    /** WMO weather interpretation code. */
    code: number;
    day: boolean;
};

const PLACE_KEY = 'meddl-tv-weather-place';
const CACHE_KEY = 'meddl-tv-weather-now';
const CACHE_MS = 20 * 60 * 1000;

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
    const controller =
        typeof AbortController === 'undefined' ? undefined : new AbortController();
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

export function savedWeatherPlace(): WeatherPlace | undefined {
    try {
        const raw = localStorage.getItem(PLACE_KEY);
        const place = raw ? (JSON.parse(raw) as WeatherPlace) : undefined;
        return place &&
            typeof place.latitude === 'number' &&
            typeof place.longitude === 'number'
            ? place
            : undefined;
    } catch {
        return undefined;
    }
}

export function saveWeatherPlace(place: WeatherPlace | undefined) {
    try {
        if (place) localStorage.setItem(PLACE_KEY, JSON.stringify(place));
        else localStorage.removeItem(PLACE_KEY);
        localStorage.removeItem(CACHE_KEY);
    } catch {
        // Storage unavailable: the place applies until the app closes.
    }
}

/** Finds a town by name; undefined when nothing matches. */
export async function findWeatherPlace(
    query: string,
    language: string
): Promise<WeatherPlace | undefined> {
    const url =
        'https://geocoding-api.open-meteo.com/v1/search?count=1&format=json' +
        `&language=${encodeURIComponent(language)}&name=${encodeURIComponent(query)}`;
    const body = (await getJson(url)) as {
        results?: { name: string; latitude: number; longitude: number }[];
    };
    const hit = body.results?.[0];
    return hit
        ? { name: hit.name, latitude: hit.latitude, longitude: hit.longitude }
        : undefined;
}

export async function currentWeather(place: WeatherPlace): Promise<WeatherNow> {
    const key = `${place.latitude},${place.longitude}`;
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as {
            key: string;
            at: number;
            value: WeatherNow;
        } | null;
        if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS)
            return cached.value;
    } catch {
        // No usable cache: ask the service.
    }
    const url =
        'https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,is_day' +
        `&latitude=${place.latitude}&longitude=${place.longitude}`;
    const body = (await getJson(url)) as {
        current?: { temperature_2m: number; weather_code: number; is_day: number };
    };
    if (!body.current) throw new Error('No current weather');
    const value: WeatherNow = {
        temperature: Math.round(body.current.temperature_2m),
        code: body.current.weather_code,
        day: body.current.is_day !== 0,
    };
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), value }));
    } catch {
        // Not cached; the next refresh asks again.
    }
    return value;
}
