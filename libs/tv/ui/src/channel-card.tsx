import { useState } from 'preact/hooks';
import { Media, t } from '@meddl/tv/util';
import { TvIcon } from './icon';
/** A local vector remains visible when a channel has no logo or its URL fails. */
/**
 * The channel's logo. Without one (or when it fails to load) the box shows the
 * channel's name when given, otherwise a TV icon.
 */
export function ChannelLogo({ src, name }: { src?: string; name?: string }) {
    // The name stands in only when there is no logo or it cannot be loaded –
    // never behind a logo with a transparent background.
    const [failed, setFailed] = useState('');
    const showLogo = !!src && failed !== src;
    return (
        <span class={`channel-logo ${name && !showLogo ? 'named' : ''}`} aria-hidden="true">
            {showLogo ? (
                <img key={src} src={src} alt="" loading="lazy" onError={() => setFailed(src ?? '')} />
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
