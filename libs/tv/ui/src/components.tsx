import { useEffect, useState } from 'preact/hooks';
import { ChannelCard } from './channel-card';
import { whenSettled } from './focus';
import { Media, t } from '@meddl/tv/util';
export * from './focus';

type AndroidShell = { MeddlAndroid?: { isTelevision?: () => boolean; hasDirectFetch?: () => boolean } };

function onTelevision(): boolean {
    try {
        return !!(window as unknown as AndroidShell).MeddlAndroid?.isTelevision?.();
    } catch {
        return false;
    }
}

/** On a TV (Android app): the poster made small by the app (DirectFetch w=). */
function smallPoster(src: string): string | undefined {
    try {
        const shell = (window as unknown as AndroidShell).MeddlAndroid;
        if (!shell?.isTelevision?.() || !shell.hasDirectFetch?.()) return undefined;
    } catch {
        return undefined;
    }
    const headers = JSON.stringify({ 'User-Agent': navigator.userAgent, Accept: 'image/*,*/*;q=0.8' });
    return `/__meddl/fetch?${new URLSearchParams({ u: src, h: headers, t: '20000', w: '360' })}`;
}

/**
 * A poster that starts loading only once the viewer stops holding an arrow
 * (a held arrow passes dozens of posters a second; loading and decoding
 * them all made scrolling stutter on TVs). On a TV the app delivers it
 * small; the original stays the fallback.
 */
function PosterImage({ src }: { src: string }) {
    const [ready, setReady] = useState(() => !onTelevision());
    const [step, setStep] = useState({ src: '', step: 0 });
    useEffect(() => (ready ? undefined : whenSettled(() => setReady(true))), []);
    if (!ready) return null;
    const candidates = [smallPoster(src), src].filter((url): url is string => !!url);
    const current = candidates[step.src === src ? step.step : 0];
    if (!current) return null;
    return (
        <img
            key={current}
            src={current}
            loading="lazy"
            decoding="async"
            alt=""
            onError={() => setStep({ src, step: (step.src === src ? step.step : 0) + 1 })}
        />
    );
}
export function Poster({
    item,
    open,
    saved,
    ...attributes
}: {
    item: Media;
    open: (m: Media) => void;
    saved?: boolean;
    'data-virtual-index'?: number;
}) {
    if (item.kind === 'live')
        return <ChannelCard item={item} open={open} {...attributes} />;
    return (
        <button
            {...attributes}
            class="poster-card"
            data-focus={item.id}
            onClick={() => open(item)}
        >
            <span class="poster-art">
                {item.poster ? <PosterImage src={item.poster} /> : null}
                <span class="poster-fallback">{item.title}</span>
                <small>
                    {item.kind === 'series'
                        ? t('SERIES')
                        : item.kind === 'episode'
                          ? t('EPISODE')
                          : t('FILM')}
                </small>
            </span>
            <strong>{item.title}</strong>
            <span class="muted">
                {saved ? t('♥ Saved') : item.year || t('From your source')}
            </span>
        </button>
    );
}
export function Empty({ children }: { children: preact.ComponentChildren }) {
    return <div class="empty">{children}</div>;
}
