import { useEffect, useState } from 'preact/hooks';
import { TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';

/** WebKit's AirPlay additions to the video element (iPhone, iPad, Safari). */
type AirPlayVideo = HTMLVideoElement & {
    webkitShowPlaybackTargetPicker?: () => void;
    webkitCurrentPlaybackTargetIsWireless?: boolean;
};

/**
 * AirPlay: sends the running title to an Apple TV or an AirPlay TV (the
 * stream itself, so the picture is sharp and the phone may lock). Shown only
 * where the system offers AirPlay and a receiver is around.
 */
export function AirPlayButton({ video }: { video: HTMLVideoElement | null }) {
    const element = video as AirPlayVideo | null;
    const [available, setAvailable] = useState(false);
    const [active, setActive] = useState(false);
    useEffect(() => {
        if (!element || typeof element.webkitShowPlaybackTargetPicker !== 'function') return;
        element.setAttribute('x-webkit-airplay', 'allow');
        const availability = (event: Event) =>
            setAvailable((event as Event & { availability?: string }).availability === 'available');
        const changed = () => setActive(!!element.webkitCurrentPlaybackTargetIsWireless);
        element.addEventListener('webkitplaybacktargetavailabilitychanged', availability);
        element.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', changed);
        changed();
        return () => {
            element.removeEventListener('webkitplaybacktargetavailabilitychanged', availability);
            element.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', changed);
        };
    }, [element]);
    if (!element || typeof element.webkitShowPlaybackTargetPicker !== 'function' || (!available && !active))
        return null;
    return (
        <button
            class={`round airplay-button ${active ? 'is-active' : ''}`}
            data-focus="player-airplay"
            aria-label={t('AirPlay')}
            aria-pressed={active}
            onClick={() => element.webkitShowPlaybackTargetPicker?.()}
        >
            <TvIcon name="airplay" />
        </button>
    );
}
