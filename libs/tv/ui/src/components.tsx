import { useEffect, useState } from 'preact/hooks';
import { ChannelCard } from './channel-card';
import { TvIcon } from './icon';
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
function PosterImage({ src, onLoaded, onFailed }: { src: string; onLoaded: () => void; onFailed: () => void }) {
    const [ready, setReady] = useState(() => !onTelevision());
    const [step, setStep] = useState({ src: '', step: 0 });
    useEffect(() => (ready ? undefined : whenSettled(() => setReady(true))), []);
    const candidates = [smallPoster(src), src].filter((url): url is string => !!url);
    const at = step.src === src ? step.step : 0;
    const current = candidates[at];
    useEffect(() => {
        if (ready && !current) onFailed();
    }, [ready, current]);
    if (!ready || !current) return null;
    return (
        <img
            key={current}
            src={current}
            loading="lazy"
            decoding="async"
            alt=""
            onLoad={onLoaded}
            onError={() => setStep({ src, step: at + 1 })}
        />
    );
}

/**
 * The poster's frame: a quiet placeholder while the picture loads (it
 * fades in), the title only when there is no picture or it cannot load.
 */
function PosterArt({ item, children }: { item: Media; children: preact.ComponentChildren }) {
    const [art, setArt] = useState({ src: '', state: 'loading' as 'loading' | 'loaded' | 'failed' });
    const src = item.poster ?? '';
    const state = !src ? 'failed' : art.src === src ? art.state : 'loading';
    return (
        <span class={`poster-art art-${state}`}>
            {src ? (
                <PosterImage
                    key={src}
                    src={src}
                    onLoaded={() => setArt({ src, state: 'loaded' })}
                    onFailed={() => setArt({ src, state: 'failed' })}
                />
            ) : null}
            {state === 'failed' ? <span class="poster-fallback">{item.title}</span> : null}
            {children}
        </span>
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
            <PosterArt item={item}>
                <small>
                    {item.kind === 'series'
                        ? t('SERIES')
                        : item.kind === 'episode'
                          ? t('EPISODE')
                          : t('FILM')}
                </small>
            </PosterArt>
            <strong>{item.title}</strong>
            <span class="muted">
                {saved ? t('♥ Saved') : item.year || t('From your source')}
            </span>
        </button>
    );
}
/**
 * An empty list or search: a quiet symbol, the sentence and, when there is
 * one, the way out (another category, clear the search).
 */
export function Empty({
    children,
    icon = 'list',
    action,
}: {
    children: preact.ComponentChildren;
    icon?: string;
    action?: { label: string; run: () => void; focus?: string };
}) {
    return (
        <div class="empty">
            <span class="empty-icon" aria-hidden="true">
                <TvIcon name={icon} />
            </span>
            <p>{children}</p>
            {action ? (
                <button class="primary empty-action" data-focus={action.focus} onClick={action.run}>
                    {action.label}
                </button>
            ) : null}
        </div>
    );
}
