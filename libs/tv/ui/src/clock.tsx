import { useEffect, useState } from 'preact/hooks';
import { tvLocale } from '@meddl/tv/util';

/** Wall clock; `large` adds the weekday and date (home screen). */
export function Clock({ large = false }: { large?: boolean }) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        // Align to the next full minute, then tick every minute.
        let interval: ReturnType<typeof setInterval> | undefined;
        const first = setTimeout(
            () => {
                setNow(new Date());
                interval = setInterval(() => setNow(new Date()), 60000);
            },
            60000 - (Date.now() % 60000)
        );
        return () => {
            clearTimeout(first);
            if (interval) clearInterval(interval);
        };
    }, []);
    const time = now.toLocaleTimeString(tvLocale(), {
        hour: '2-digit',
        minute: '2-digit',
    });
    if (!large) return <time class="clock">{time}</time>;
    return (
        <div class="clock-large">
            <time>{time}</time>
            <span>
                {now.toLocaleDateString(tvLocale(), {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                })}
            </span>
        </div>
    );
}
