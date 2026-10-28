import { useEffect, useRef, useState } from 'preact/hooks';
import { findParentSeries } from '@meddl/tv/data-access';
import type { Media } from '@meddl/tv/util';
import { restoreFocus } from '@meddl/tv/ui';
import { episodeAfter } from './episode-order';
export { episodeAfter } from './episode-order';
import type { TvModel } from './use-tv';

/** Seconds shown before the next episode starts by itself. */
export const AUTOPLAY_SECONDS = 8;

/**
 * Next episode for the player: from the series page's episode list, or
 * looked up through the parent series (Continue watching, Home). When an
 * episode ends, a short countdown plays the next one unless cancelled.
 */
export function useNextEpisode(tv: TvModel, video: HTMLVideoElement | null) {
    const current = tv.playing?.kind === 'episode' ? tv.playing : undefined;
    const [list, setList] = useState<{ id: string; episodes: Media[] }>({ id: '', episodes: [] });
    const [countdown, setCountdown] = useState<number | null>(null);
    const latest = useRef(tv);
    latest.current = tv;

    useEffect(() => {
        setCountdown(null);
        if (!current) return;
        if (tv.episodes.some((e) => e.id === current.id)) {
            setList({ id: current.id, episodes: tv.episodes });
            return;
        }
        const client = tv.guideClient;
        const source = tv.data.sources.find((s) => s.id === current.sourceId);
        if (!client || !source) return;
        const abort = new AbortController();
        void (async () => {
            try {
                const parent = await findParentSeries(client, source, current, abort.signal);
                if (!parent) return;
                const episodes = await client.episodes(parent, abort.signal);
                if (!abort.signal.aborted) setList({ id: current.id, episodes });
            } catch {
                // No next episode then; playback is unaffected.
            }
        })();
        return () => abort.abort();
    }, [current?.id, tv.episodes, tv.guideClient]);

    const next = current && list.id === current.id ? episodeAfter(current, list.episodes) : undefined;

    function playNext() {
        setCountdown(null);
        if (!next) return;
        latest.current.setSelected(next);
        void latest.current.play(next);
    }

    // The episode finished: count down, then continue with the next one.
    useEffect(() => {
        if (!video || !next) return;
        const ended = () => {
            setCountdown(AUTOPLAY_SECONDS);
            restoreFocus('next-now');
        };
        video.addEventListener('ended', ended);
        return () => video.removeEventListener('ended', ended);
    }, [video, next?.id]);
    useEffect(() => {
        if (countdown === null) return;
        if (countdown <= 0) {
            playNext();
            return;
        }
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    return {
        next,
        countdown,
        playNext,
        cancel: () => setCountdown(null),
        /** The app's own player reached the end of the episode. */
        begin: () => next && setCountdown(AUTOPLAY_SECONDS),
    };
}
