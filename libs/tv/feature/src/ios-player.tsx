import { useEffect, useRef } from 'preact/hooks';
import { iosApp } from '@meddl/tv/data-access';
import { TvIcon } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import type { TvModel } from './use-tv';

type IosVideo = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
};

/**
 * iPhone / iPad app: films, episodes and channels play in iOS's own player
 * (the video has no playsinline there, so playback opens it in full screen:
 * scrubbing, AirPlay, picture in picture, the familiar controls). Closing it
 * returns to the list or the title page.
 */
export function useIosPlayer(tv: TvModel, video: { current: HTMLVideoElement | null }) {
    const ios = iosApp();
    const latest = useRef(tv);
    latest.current = tv;
    useEffect(() => {
        const element = video.current as IosVideo | null;
        if (!ios || !element) return;
        const ended = () => {
            if (latest.current.fullscreen) latest.current.back();
        };
        element.addEventListener('webkitendfullscreen', ended);
        return () => element.removeEventListener('webkitendfullscreen', ended);
    }, [ios]);
    // Already loaded, paused and back in full screen: open the iOS player again.
    useEffect(() => {
        const element = video.current as IosVideo | null;
        if (!ios || !element || !tv.fullscreen || !tv.playing) return;
        const open = () => {
            if (!element.webkitDisplayingFullscreen) {
                try {
                    element.webkitEnterFullscreen?.();
                } catch {
                    // Opens with the next playback instead.
                }
            }
        };
        element.addEventListener('playing', open);
        return () => element.removeEventListener('playing', open);
    }, [ios, tv.fullscreen, tv.playing?.id]);
    return ios;
}

/** Behind the iOS player (while it opens, or when a stream fails): back and status only. */
export function IosPlayerScreen({ tv }: { tv: TvModel }) {
    return (
        <div class="ios-player-screen">
            <button class="round" data-focus="player-back" aria-label={t('Back')} onClick={tv.back}>
                <TvIcon name="back" />
            </button>
            {tv.error ? (
                <div role="alert" class="error">
                    {tv.error}
                    {tv.errorRetry ? <button onClick={tv.errorRetry}>{tv.errorRetryLabel}</button> : null}
                </div>
            ) : (
                <span class="spinner large" aria-hidden="true" />
            )}
        </div>
    );
}
