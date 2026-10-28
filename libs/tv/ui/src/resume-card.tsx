import { Media, Progress, mediaTitle, t } from '@meddl/tv/util';
import { TvIcon } from './icon';
export function ResumeCard({
    progress,
    poster,
    play,
}: {
    progress: Progress;
    poster?: string;
    play: (item: Media) => void;
}) {
    const { item, seconds, duration } = progress;
    const knownDuration = Number.isFinite(duration) && duration > 0;
    return (
        <button
            class="resume-card"
            data-focus={item.id}
            onClick={() => play(item)}
        >
            <span class="resume-art" aria-hidden="true">
                <TvIcon
                    name={
                        item.kind === 'episode' || item.kind === 'series'
                            ? 'series'
                            : 'movies'
                    }
                />
                {poster ? (
                    <img
                        key={poster}
                        src={poster}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                            event.currentTarget.style.display = 'none';
                        }}
                    />
                ) : null}
            </span>
            <span class="resume-copy">
                <strong>{mediaTitle(item)}</strong>
                {item.kind === 'episode' ? (
                    <span class="muted">{item.title}</span>
                ) : null}
                <span class="resume-position">
                    {item.season ? `S${item.season} · E${item.episode} · ` : ''}
                    {t('{minutes} min watched', { minutes: Math.floor(seconds / 60) })}
                </span>
                <progress
                    aria-label={t('{title}: viewing progress', { title: mediaTitle(item) })}
                    max={knownDuration ? duration : undefined}
                    value={
                        knownDuration
                            ? Math.min(Math.max(seconds, 0), duration)
                            : undefined
                    }
                />
                <span class="resume-action">{t('Resume →')}</span>
            </span>
        </button>
    );
}
