import { Empty, TvIcon, VirtualCollection } from '@meddl/tv/ui';
import { TvModel } from './use-tv';
import { TvMetadata } from '@meddl/tv/data-access';
import { mediaTitle, t } from '@meddl/tv/util';
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
    if (!item || item.sourceId !== tv.data.activeId) return null;
    const episodes = metadata.items.filter(
        (e) => (e.season ?? 1) === currentSeason
    );
    const saved = tv.data.favorites.some((m) => m.id === item.id);
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
                                {tv.data.positions[item.id]?.seconds
                                    ? t('Resume')
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
                                            ? t('Resume episode')
                                            : t('Watch episode')}{' '}
                                        →
                                    </small>
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
