import { useState } from 'preact/hooks';
import { Media, t } from '@meddl/tv/util';
import { TvIcon } from './icon';
type AndroidShell = { MeddlAndroid?: { hasDirectFetch?: () => boolean } };

/**
 * The same logo fetched natively by the Android TV app (DirectFetch): many
 * provider logo hosts refuse the WebView's request (hotlink checks on the
 * Referer, picky TLS or CDN rules) but answer a plain GET. Undefined
 * outside the Android app.
 */
function logoViaApp(src: string): string | undefined {
    try {
        if (!(window as unknown as AndroidShell).MeddlAndroid?.hasDirectFetch?.()) return undefined;
    } catch {
        return undefined;
    }
    const headers = JSON.stringify({ 'User-Agent': navigator.userAgent, Accept: 'image/*,*/*;q=0.8' });
    return `/__meddl/fetch?${new URLSearchParams({ u: src, h: headers, t: '15000', c: '1' })}`;
}

/**
 * The channel's logo. Without one (or when it cannot be loaded, also not
 * through the app) the box shows the channel's name when given, otherwise a
 * TV icon – never the name behind a logo with a transparent background.
 */
export function ChannelLogo({ src, name }: { src?: string; name?: string }) {
    const [attempt, setAttempt] = useState({ src: '', step: 0 });
    const step = attempt.src === src ? attempt.step : 0;
    const candidates = src ? [src, logoViaApp(src)].filter((url): url is string => !!url) : [];
    const current = candidates[step];
    return (
        <span class={`channel-logo ${name && !current ? 'named' : ''}`} aria-hidden="true">
            {current ? (
                <img
                    key={current}
                    src={current}
                    alt=""
                    referrerpolicy="no-referrer"
                    decoding="async"
                    onError={() => setAttempt({ src: src ?? '', step: step + 1 })}
                />
            ) : name ? (
                <span class="channel-logo-name">{name}</span>
            ) : (
                <TvIcon name="live" />
            )}
        </span>
    );
}
export function ChannelCard({
    item,
    open,
    ...attributes
}: {
    item: Media;
    open: (item: Media) => void;
    'data-virtual-index'?: number;
}) {
    return (
        <button
            {...attributes}
            class="channel-card"
            data-focus={item.id}
            onClick={() => open(item)}
        >
            <ChannelLogo src={item.poster} />
            <span class="channel-card-copy">
                <strong>{item.title}</strong>
                <small>{t('Live TV')}</small>
            </span>
        </button>
    );
}
