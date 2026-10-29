import { LiveColumns } from './live-columns';
import { useLiveBrowse } from './use-live-browse';
import { useEffect, useRef } from 'preact/hooks';
import { TvIcon } from '@meddl/tv/ui';
import { t, tvLocale, type Program, displayChannelName } from '@meddl/tv/util';
import { TvModel } from './use-tv';

const clock = (value: number) =>
    new Date(value).toLocaleTimeString(tvLocale(), {
        hour: '2-digit',
        minute: '2-digit',
    });

function NowPlaying({ programme }: { programme: Program }) {
    const span = programme.end - programme.start;
    const share = span > 0 ? Math.min(1, Math.max(0, (Date.now() - programme.start) / span)) : 0;
    return (
        <div class="now-playing">
            <span class="eyebrow">{t('Now playing')}</span>
            <h2>{programme.title}</h2>
            {programme.description ? <p>{programme.description}</p> : null}
            <div class="now-progress" aria-hidden="true">
                <span style={{ width: `${Math.round(share * 100)}%` }} />
            </div>
            <div class="now-times">
                <time>{clock(programme.start)}</time>
                <time>{clock(programme.end)}</time>
            </div>
        </div>
    );
}

/**
 * Live TV page: categories (flags) · channels · preview with the running
 * programme and the upcoming schedule. While the fullscreen channel overlay
 * is open, the columns step aside so only the overlay's list takes focus.
 */
export function Live({
    tv,
    browse,
    overlayOpen,
    openGuide,
    openGrid,
}: {
    tv: TvModel;
    browse: ReturnType<typeof useLiveBrowse>;
    overlayOpen: boolean;
    openGuide: () => void;
    openGrid: () => void;
}) {
    const guide = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (guide.current) guide.current.scrollTop = 0;
    }, [tv.selected?.id]);
    const selected = tv.selected;
    const now = Date.now();
    const running = tv.epg.find((p) => p.start <= now && p.end > now);
    const upcoming = tv.epg.filter((p) => p !== running && p.end > now).slice(0, 10);
    const saved = !!selected && tv.data.favorites.some((m) => m.id === selected.id);
    return (
        <div
            class={`live-layout ${browse.categoriesOpen ? 'shows-categories' : 'shows-channels'}`}
            onKeyDown={(event) => {
                if (
                    !tv.fullscreen &&
                    !browse.categoriesOpen &&
                    (event.keyCode === 461 ||
                        ['Escape', 'BrowserBack', 'Backspace'].includes(event.key))
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    browse.back();
                }
            }}
        >
            {!overlayOpen ? (
                <LiveColumns tv={tv} browse={browse} />
            ) : (
                // The fullscreen channel overlay renders its own list.
                <div class="live-columns-placeholder" />
            )}
            <section class="live-information">
                <div class="preview-placeholder">
                    {tv.playing ? (
                        <button
                            class="preview-open"
                            data-focus="live-fullscreen"
                            onClick={() => {
                                if (tv.playing) void tv.play(tv.playing);
                            }}
                            aria-label={t('Open fullscreen')}
                        >
                            {t('Fullscreen')} ↗
                        </button>
                    ) : (
                        <span>{t('Select a channel to start preview')}</span>
                    )}
                </div>
                <div class="section-title">
                    <h2>{selected ? displayChannelName(selected.title) : t('Programme guide')}</h2>
                    <div class="actions">
                        <button data-focus="live-grid-guide" onClick={openGrid}>
                            <TvIcon name="guide" /> {t('TV Guide')}
                        </button>
                        <button
                            data-focus="live-expand-guide"
                            onClick={openGuide}
                            disabled={!selected}
                        >
                            {t('Programme')} ↗
                        </button>
                        {selected ? (
                            <button
                                class={`round ${saved ? 'is-favorite' : ''}`}
                                aria-label={saved ? t('Remove from favorites') : t('Add to favorites')}
                                aria-pressed={saved}
                                onClick={() => tv.favorite(selected)}
                            >
                                <TvIcon name="star" />
                            </button>
                        ) : null}
                    </div>
                </div>
                <div
                    class="programme-list"
                    ref={guide}
                    tabIndex={0}
                    data-tv-scroll
                    data-focus="live-guide"
                    role="region"
                    aria-label={t('Programme guide')}
                    onKeyDown={(event) => {
                        const pane = event.currentTarget;
                        const down = event.key === 'ArrowDown' || event.keyCode === 40;
                        const up = event.key === 'ArrowUp' || event.keyCode === 38;
                        if (down || (up && pane.scrollTop > 0)) {
                            event.preventDefault();
                            event.stopPropagation();
                            pane.scrollTop += down ? 100 : -100;
                        }
                    }}
                >
                    {tv.data.epg ? (
                        <>
                            {running ? <NowPlaying programme={running} /> : null}
                            {upcoming.map((p) => (
                                <div class="programme">
                                    <time>{clock(p.start)}</time>
                                    <div>
                                        <strong>{p.title}</strong>
                                        <small>
                                            {t('until {time}', { time: clock(p.end) })}
                                        </small>
                                    </div>
                                </div>
                            ))}
                            {!tv.epg.length ? (
                                <p class="muted">
                                    {tv.epgError || t('No programme information supplied.')}
                                </p>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </section>
        </div>
    );
}
