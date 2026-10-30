import { useEffect } from 'preact/hooks';
import { Empty, TvIcon, VirtualCollection } from '@meddl/tv/ui';
import { TvModel } from './use-tv';
import { TvMetadata } from '@meddl/tv/data-access';
import { mediaTitle, t, tvLocale, type Progress } from '@meddl/tv/util';
import { clock } from './desktop-player-bar';

/** The episode of this series watched last (history first, then all saved positions). */
function lastEpisode(data: TvModel['data'], seriesId: string): Progress | undefined {
    const ofSeries = (p: Progress) => p.item.kind === 'episode' && p.item.parentId === seriesId;
    return (
        data.history.find(ofSeries) ??
        Object.values(data.positions)
            .filter(ofSeries)
            .sort((a, b) => b.updated - a.updated)[0]
    );
}

/** Watched to (nearly) the end. */
function finished(progress: Progress): boolean {
    return progress.duration > 0 && progress.seconds >= progress.duration * 0.95;
}

/** "today", "yesterday" or "30 Oct". */
function whenWatched(at: number): string {
    const day = new Date(at);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (day.toDateString() === today.toDateString()) return t('today');
    if (day.toDateString() === yesterday.toDateString()) return t('yesterday');
    return day.toLocaleDateString(tvLocale(), { day: 'numeric', month: 'short' });
}

/** Where the viewer was: "at 23:42 of 1:52:10" with a bar, or "watched". */
function LastWatched({
    progress,
    label,
    onPlay,
}: {
    progress: Progress;
    label: string;
    onPlay?: () => void;
}) {
    const done = finished(progress);
    const share = progress.duration > 0 ? Math.min(100, (progress.seconds / progress.duration) * 100) : 0;
    const where = done
        ? t('watched to the end')
        : progress.duration > 0
          ? t('at {time} of {duration}', { time: clock(progress.seconds), duration: clock(progress.duration) })
          : t('at {time}', { time: clock(progress.seconds) });
    const content = (
        <>
            <span class="last-watched-copy">
                <small>
                    {t('Last watched')} · {whenWatched(progress.updated)}
                </small>
                <strong>{label}</strong>
                <span class="last-watched-where">{where}</span>
            </span>
            {share > 0 ? (
                <span class="last-watched-bar" aria-hidden="true">
                    <span style={{ width: `${done ? 100 : share}%` }} />
                </span>
            ) : null}
        </>
    );
    return onPlay ? (
        <button class="last-watched" data-focus="detail-last-watched" onClick={onPlay}>
            {content}
        </button>
    ) : (
        <div class="last-watched">{content}</div>
    );
}
import { MetadataCredits } from './metadata-credits';
import { useEpisodeMetadata } from './use-episode-metadata';

const KIND_LABELS: Record<string, string> = { movie: 'Movie', series: 'Series', episode: 'Episode', live: 'Live TV' };

export function Detail({
    tv,
    metadataClient,
    season,
    selectSeason,
}: {
    tv: TvModel;
    metadataClient: TvMetadata;
    season?: number;
    selectSeason: (season: number) => void;
}) {
    const item = tv.selected ?? tv.route.item;
    const seasons = Array.from(
        new Set(tv.episodes.map((e) => e.season ?? 1))
    ).sort((a, b) => a - b);
    const currentSeason =
        season && seasons.includes(season) ? season : seasons[0];
    const metadata = useEpisodeMetadata(
        item,
        tv.episodes,
        currentSeason,
        metadataClient
    );
    // A series opens at the season of the episode watched last.
    const lastSeason =
        item?.kind === 'series'
            ? lastEpisode(tv.data, item.id)?.item.season
            : undefined;
    useEffect(() => {
        if (!season && lastSeason && seasons.includes(lastSeason) && lastSeason !== currentSeason) selectSeason(lastSeason);
    }, [item?.id, lastSeason, seasons.length]);
    if (!item || item.sourceId !== tv.data.activeId) return null;
    const episodes = metadata.items.filter(
        (e) => (e.season ?? 1) === currentSeason
    );
    const saved = tv.data.favorites.some((m) => m.id === item.id);
    // Films: where the viewer stopped. Series: the episode watched last.
    const last =
        item.kind === 'series'
            ? lastEpisode(tv.data, item.id)
            : tv.data.positions[item.id];
    return (
        <>
            <section class="detail-hero">
                <div class="detail-poster">
                    {/* Shown when there is no picture or it does not load. */}
                    <span class="detail-poster-fallback">
                        <TvIcon name={item.kind === 'series' || item.kind === 'episode' ? 'series' : 'movies'} />
                        <strong>{mediaTitle(item)}</strong>
                    </span>
                    {item.poster ? (
                        <img
                            src={item.poster}
                            alt=""
                            onError={(event) => {
                                event.currentTarget.style.display = 'none';
                            }}
                        />
                    ) : null}
                </div>
                <div>
                    <span class="eyebrow">
                        {t(KIND_LABELS[item.kind] ?? 'Movie').toUpperCase()}{' '}
                        {item.year ? `· ${item.year}` : ''}
                    </span>
                    <h1>{mediaTitle(item)}</h1>
                    {item.kind === 'episode' ? (
                        <div class="muted">
                            S{item.season ?? 1} · E{item.episode ?? 1} ·{' '}
                            {item.title}
                        </div>
                    ) : null}
                    <p>
                        {item.description ||
                            t('Your provider has not supplied a description for this title.')}
                    </p>
                    <div class="actions">
                        {item.kind !== 'series' ? (
                            <button
                                class="primary"
                                data-focus="detail-play"
                                onClick={() => tv.play(item)}
                            >
                                {tv.data.positions[item.id]?.seconds && !finished(tv.data.positions[item.id])
                                    ? t('Resume at {time}', { time: clock(tv.data.positions[item.id].seconds) })
                                    : t('Watch now')}{' '}
                                ▶
                            </button>
                        ) : null}
                        <button
                            data-focus={
                                item.kind === 'series'
                                    ? 'detail-play'
                                    : 'favorite'
                            }
                            aria-pressed={saved}
                            onClick={() => tv.favorite(item)}
                        >
                            {saved ? t('♥ Saved') : t('♡ Add to favorites')}
                        </button>
                    </div>
                    {last && last.seconds > 0 ? (
                        item.kind === 'series' ? (
                            <LastWatched
                                progress={last}
                                label={`S${last.item.season ?? 1} · E${last.item.episode ?? 1} · ${last.item.title}`}
                                onPlay={() => tv.play(last.item)}
                            />
                        ) : (
                            <LastWatched progress={last} label={mediaTitle(item)} />
                        )
                    ) : null}
                </div>
            </section>
            <MetadataCredits item={item} open={tv.openPerson} />
            {item.kind === 'series' ? (
                <section
                    class={
                        episodes.some((e) => e.episodeStill)
                            ? 'rich-episodes'
                            : ''
                    }
                >
                    <div class="section-title">
                        <h2>{t('Episodes')}</h2>
                        <label>
                            {t('Season')}
                            <select
                                aria-label={t('Season')}
                                value={currentSeason}
                                onChange={(e) => {
                                    selectSeason(Number(e.currentTarget.value));
                                }}
                            >
                                {seasons.map((s) => (
                                    <option value={s}>Season {s}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                    {metadata.failed ? (
                        <p role="status" class="metadata-notice">
                            {t('Episode metadata is unavailable. Showing provider episodes.')}{' '}
                            <button onClick={metadata.retry}>
                                {t('Retry episode metadata')}
                            </button>
                        </p>
                    ) : null}
                    <VirtualCollection
                        key={`${item.id}:${currentSeason}`}
                        layout="episodes"
                        items={episodes}
                        render={(e) => (
                            <button
                                data-focus={e.id}
                                key={e.id}
                                class={`episode ${e.episodeStill ? 'with-still' : ''}`}
                                onClick={() => tv.play(e)}
                            >
                                {e.episodeStill ? (
                                    <img
                                        key={e.episodeStill}
                                        class="episode-still"
                                        src={e.episodeStill}
                                        alt=""
                                        loading="lazy"
                                        onError={(event) => {
                                            event.currentTarget.style.display =
                                                'none';
                                        }}
                                    />
                                ) : null}
                                <span class="episode-copy">
                                    <span class="episode-number">
                                        {String(e.episode ?? 1).padStart(
                                            2,
                                            '0'
                                        )}
                                    </span>
                                    <strong>{e.title}</strong>
                                    {e.description ? (
                                        <span class="episode-description">
                                            {e.description}
                                        </span>
                                    ) : null}
                                    <small>
                                        {tv.data.positions[e.id]?.seconds
                                            ? finished(tv.data.positions[e.id])
                                                ? t('✓ Watched')
                                                : t('Resume at {time}', { time: clock(tv.data.positions[e.id].seconds) })
                                            : t('Watch episode')}{' '}
                                        {tv.data.positions[e.id]?.seconds && finished(tv.data.positions[e.id]) ? '' : '→'}
                                    </small>
                                    {tv.data.positions[e.id]?.seconds && tv.data.positions[e.id].duration > 0 ? (
                                        <span class="episode-progress" aria-hidden="true">
                                            <span
                                                style={{
                                                    width: `${Math.min(100, (tv.data.positions[e.id].seconds / tv.data.positions[e.id].duration) * 100)}%`,
                                                }}
                                            />
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                        )}
                    />
                    {!tv.busy && !episodes.length ? (
                        <Empty>
                            {t('No episodes were supplied for this series.')}
                        </Empty>
                    ) : null}
                </section>
            ) : null}
        </>
    );
}
