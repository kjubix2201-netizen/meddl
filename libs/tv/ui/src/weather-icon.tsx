/** Filled weather glyphs for the Home clock, chosen from a WMO weather code. */
const CLOUD =
    'M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.6 9.1 5 5 0 0 0 7 19z';
const SMALL_CLOUD =
    'M8 16h8.5a3.5 3.5 0 0 0 .5-6.97A4.7 4.7 0 0 0 8 8.6 3.8 3.8 0 0 0 8 16z';

type Kind = 'sun' | 'moon' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export function weatherKind(code: number, day: boolean): Kind {
    if (code === 0) return day ? 'sun' : 'moon';
    if (code === 1 || code === 2) return day ? 'partly' : 'moon';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'cloud';
}

export function WeatherIcon({ code, day }: { code: number; day: boolean }) {
    const kind = weatherKind(code, day);
    return (
        <svg
            class={`weather-icon weather-${kind}`}
            width="24"
            height="24"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
        >
            {kind === 'sun' ? (
                <>
                    <circle cx="12" cy="12" r="4.2" stroke="none" />
                    <path
                        fill="none"
                        d="M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4"
                    />
                </>
            ) : kind === 'moon' ? (
                <path stroke="none" d="M15.5 3.5a8.5 8.5 0 1 0 5 13.8A7 7 0 0 1 15.5 3.5z" />
            ) : kind === 'partly' ? (
                <>
                    <circle cx="9" cy="8" r="3.4" stroke="none" opacity="0.85" />
                    <path stroke="none" d={CLOUD} transform="translate(1.5 1.5) scale(0.92)" />
                </>
            ) : kind === 'cloud' ? (
                <path stroke="none" d={CLOUD} />
            ) : kind === 'fog' ? (
                <>
                    <path stroke="none" d={SMALL_CLOUD} />
                    <path fill="none" d="M5 19h14 M7 22h10" />
                </>
            ) : (
                <>
                    <path stroke="none" d={SMALL_CLOUD} />
                    <path
                        fill="none"
                        d={
                            kind === 'snow'
                                ? 'M9 19.5h.01 M12 21.5h.01 M15 19.5h.01'
                                : kind === 'storm'
                                  ? 'M13 16.5l-2 3h3l-2 3'
                                  : 'M9 18.5l-1 3 M13 18.5l-1 3 M17 18.5l-1 3'
                        }
                    />
                </>
            )}
        </svg>
    );
}
