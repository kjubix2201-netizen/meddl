import { mediaTitle, type Media, type Progress, t } from '@meddl/tv/util';
export function Hero({
    item,
    open,
    play,
    progress,
    index = 0,
    count = 0,
    select,
    compact = false,
    detailsBusy = false,
}: {
    item?: Media;
    open: (item: Media) => void;
    play: (item: Media) => void;
    progress?: Progress;
    index?: number;
    count?: number;
    select: (index: number) => void;
    compact?: boolean;
    detailsBusy?: boolean;
}) {
    return (
        <section
            class={`hero ${compact ? 'compact' : ''}`}
            aria-label={t('Featured title')}
        >
            <div class="hero-copy">
                <span class="eyebrow">
                    {progress
                        ? t('PICK UP WHERE YOU LEFT OFF')
                        : t('YOUR OWN CINEMA')}
                </span>
                <h1>{item ? mediaTitle(item) : t('Make yourself at home.')}</h1>
                {progress ? (
                    <div class="hero-position">
                        {progress.item.kind === 'episode'
                            ? `S${progress.item.season ?? 1} · E${progress.item.episode ?? 1} · ${progress.item.title} · `
                            : ''}
                        {Math.floor(progress.seconds / 60)} min watched
                        {progress.duration > 0 ? (
                            <progress
                                aria-label={t('Featured viewing progress')}
                                max={progress.duration}
                                value={progress.seconds}
                            />
                        ) : null}
                    </div>
                ) : null}
                <p>
                    {item?.description ||
                        (progress
                            ? t('Your next scene is waiting. Continue from your saved position.')
                            : t('Live television, films and stories from your own sources. Pick something worth staying in for.'))}
                </p>
                {item ? (
                    <div class="actions">
                        {progress ? (
                            <button
                                class="primary"
                                data-focus="hero-resume"
                                onClick={() => play(progress.item)}
                            >
                                {t('Continue watching ▷')}
                            </button>
                        ) : null}
                        <button
                            class={progress ? '' : 'primary'}
                            data-focus="hero"
                            disabled={detailsBusy}
                            onClick={() => open(item)}
                        >
                            {detailsBusy
                                ? t('Finding series…')
                                : progress
                                  ? t('Details →')
                                  : t('Explore title →')}
                        </button>
                    </div>
                ) : null}
                {count > 1 ? (
                    <div
                        class="hero-switcher"
                        role="group"
                        aria-label={t('Unfinished titles')}
                    >
                        <button
                            data-focus="hero-previous"
                            aria-label={t('Previous unfinished title')}
                            onClick={() => select(index - 1)}
                        >
                            ←
                        </button>
                        <span aria-live="polite" aria-atomic="true">
                            {index + 1} / {count}
                        </span>
                        <button
                            data-focus="hero-next"
                            aria-label={t('Next unfinished title')}
                            onClick={() => select(index + 1)}
                        >
                            →
                        </button>
                    </div>
                ) : null}
            </div>
            {!progress ? (
                <span class="hero-number">
                    MEDDL<span> {t('TV')}</span>
                </span>
            ) : null}
        </section>
    );
}
