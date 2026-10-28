import type { Media } from '@meddl/tv/util';

/** Episode after `current` in season / episode order, if any. */
export function episodeAfter(current: Media, episodes: readonly Media[]): Media | undefined {
    const list = episodes
        .filter((e) => e.kind === 'episode')
        .map((e, index) => ({ e, index }))
        .sort(
            (a, b) =>
                (a.e.season ?? 1) - (b.e.season ?? 1) ||
                (a.e.episode ?? a.index) - (b.e.episode ?? b.index) ||
                a.index - b.index
        )
        .map(({ e }) => e);
    const at = list.findIndex((e) => e.id === current.id);
    return at >= 0 ? list[at + 1] : undefined;
}
