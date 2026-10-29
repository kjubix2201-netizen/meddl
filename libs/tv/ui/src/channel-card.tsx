import { Media, t } from '@meddl/tv/util';
import { TvIcon } from './icon';
/** A local vector remains visible when a channel has no logo or its URL fails. */
/**
 * The channel's logo. Without one (or while it loads) the box shows the
 * channel's name when given, otherwise a TV icon.
 */
export function ChannelLogo({ src, name }: { src?: string; name?: string }) {
    return (
        <span class={`channel-logo ${name ? 'named' : ''}`} aria-hidden="true">
            {name ? <span class="channel-logo-name">{name}</span> : <TvIcon name="live" />}
            {src ? (
                <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                        event.currentTarget.style.display = 'none';
                    }}
                />
            ) : null}
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
