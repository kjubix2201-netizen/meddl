import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'preact/hooks';
import {
    GUIDE_HOUR,
    GUIDE_SPAN,
    gridProgramAt,
    gridTime,
    guideWindow, t } from '@meddl/tv/util';
import { restoreFocus } from '@meddl/tv/ui';
import { useGridGuide, useGridRows } from './use-grid-guide';
import { useGridNavigation } from './use-grid-navigation';
import { GridGuideRows } from './grid-guide-rows';
import type { useCatalog } from './use-catalog';
import type { TvModel } from './use-tv';

export function GridSchedule({
    tv,
    category,
    catalog,
    close,
}: {
    tv: TvModel;
    category: string;
    catalog: ReturnType<typeof useCatalog>;
    close: () => void;
}) {
    const [now, setNow] = useState(Date.now);
    const [axis, setAxis] = useState(() => guideWindow(Date.now()));
    // Pin only the opening channel. Switching while browsing must not reorder rows.
    const opening = useRef(
        tv.playingCategory === category ? tv.playing : undefined
    );
    const items = useMemo(
        () =>
            opening.current
                ? [
                      opening.current,
                      ...catalog.catalog.items.filter(
                          (m) => m.id !== opening.current?.id
                      ),
                  ]
                : catalog.catalog.items,
        [catalog.catalog.items]
    );
    const [visible, setVisible] = useState<typeof items>([]);
    const guide = useGridGuide(tv.guideClient, visible, tv.data.epg);
    const navigation = useGridNavigation(
        items,
        guide.schedules,
        axis,
        setAxis,
        catalog.loadMore,
        catalog.hasMore
    );
    const indices = useGridRows(
        items,
        navigation.scroll,
        navigation.selection.row
    );
    useEffect(() => setVisible(indices.map((i) => items[i])), [items, indices]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        const pane = navigation.list.current;
        if (
            pane &&
            catalog.hasMore &&
            !catalog.catalogBusy &&
            !catalog.catalogError &&
            pane.scrollTop + pane.clientHeight + 176 >= items.length * 88
        )
            catalog.loadMore();
    }, [
        items.length,
        catalog.hasMore,
        catalog.catalogBusy,
        catalog.catalogError,
    ]);
    const channel = items[navigation.selection.row];
    const schedule = guide.schedules.get(channel?.id);
    const program =
        schedule?.programs.find(
            (p) =>
                p.id === navigation.selection.key &&
                p.start < axis.endMs &&
                p.end > axis.startMs
        ) ??
        gridProgramAt(
            schedule?.programs ?? [],
            axis,
            navigation.selection.time
        );
    const unavailable = !tv.data.epg
        ? t('Programme guide is disabled in Settings.')
        : !guide.supported
          ? t('This source does not supply a programme guide.')
          : '';
    const shift = (hours: number) =>
        setAxis({
            startMs: axis.startMs + hours * GUIDE_HOUR,
            endMs: axis.endMs + hours * GUIDE_HOUR,
        });
    const shiftDay = (days: number) => {
        const date = new Date(axis.startMs);
        date.setDate(date.getDate() + days);
        setAxis({
            startMs: date.getTime(),
            endMs: date.getTime() + GUIDE_SPAN,
        });
    };
    const mounted = useRef(true);
    const playback = useRef<AbortController>();
    const [starting, setStarting] = useState(false);
    useLayoutEffect(
        () => () => {
            mounted.current = false;
            playback.current?.abort();
        },
        []
    );
    const watch = async () => {
        if (!channel) return;
        setStarting(true);
        playback.current?.abort();
        playback.current = new AbortController();
        const started = await tv.play(
            channel,
            category,
            'live-grid-guide',
            playback.current.signal
        );
        if (!mounted.current) return;
        setStarting(false);
        if (started) {
            tv.setSelected(channel);
            close();
            tv.setFullscreen(true);
            restoreFocus('player-toggle');
        }
    };
    const inspect = () => restoreFocus('grid-watch');
    return (
        <>
            <div class="grid-toolbar">
                <button
                    data-focus="grid-now"
                    onClick={() => {
                        setNow(Date.now());
                        const window = guideWindow(Date.now());
                        setAxis(window);
                        navigation.focus(
                            navigation.selection.row,
                            false,
                            Date.now(),
                            window
                        );
                    }}
                >
                    {t('Now')}
                </button>
                <button aria-label={t('Previous day')} onClick={() => shiftDay(-1)}>
                    {t('−1 day')}
                </button>
                <button
                    aria-label={t('Earlier programmes')}
                    onClick={() => shift(-GUIDE_SPAN / GUIDE_HOUR)}
                >
                    {t('← Earlier')}
                </button>
                <span class="grid-date">
                    {new Date(axis.startMs).toLocaleDateString([], {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                    })}{' '}
                    · {gridTime(axis.startMs)}–{gridTime(axis.endMs)}
                </span>
                <button
                    aria-label={t('Later programmes')}
                    onClick={() => shift(GUIDE_SPAN / GUIDE_HOUR)}
                >
                    {t('Later →')}
                </button>
                <button aria-label={t('Next day')} onClick={() => shiftDay(1)}>
                    {t('+1 day')}
                </button>
            </div>
            <GridGuideRows
                items={items}
                indices={indices}
                schedules={guide.schedules}
                axis={axis}
                now={now}
                navigation={navigation}
                playingId={tv.playing?.id}
                message={unavailable}
                inspect={inspect}
                loadMore={catalog.loadMore}
                more={catalog.hasMore}
                busy={catalog.catalogBusy}
                error={catalog.catalogError}
            />
            {tv.error ? (
                <p role="alert" class="grid-play-error">
                    {tv.error}
                </p>
            ) : null}
            {starting ? <p role="status">{t('Opening channel…')}</p> : null}
            <footer class="grid-details">
                <div>
                    <small>
                        {channel?.title ?? t('Choose a channel')}
                        {program
                            ? ` · ${gridTime(program.start)}–${gridTime(program.end)}`
                            : ''}
                    </small>
                    <h2>{program?.title ?? t('Live TV')}</h2>
                    <div
                        class="grid-description"
                        tabIndex={0}
                        data-tv-scroll
                        data-focus="grid-description"
                        aria-label={t('Programme description')}
                        key={program?.id}
                        onKeyDown={(event) => {
                            if (
                                event.key === 'ArrowDown' ||
                                event.key === 'ArrowUp'
                            ) {
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget.scrollTop +=
                                    event.key === 'ArrowDown' ? 80 : -80;
                            }
                        }}
                    >
                        {schedule?.status === 'error'
                            ? t('Programme refresh failed. Use Refresh guide to retry.') + ' '
                            : ''}
                        {program?.description ||
                            unavailable ||
                            t('Only programmes supplied by this source are shown. Watch live opens the current broadcast.')}
                    </div>
                </div>
                <div class="grid-details-actions">
                    <button
                        class="primary"
                        data-focus="grid-watch"
                        disabled={!channel || starting}
                        onClick={watch}
                    >
                        {t('Watch live ▶')}
                    </button>
                    <button
                        onClick={() =>
                            navigation.focus(
                                navigation.selection.row,
                                false,
                                navigation.selection.time
                            )
                        }
                    >
                        {t('Back to programmes ↑')}
                    </button>
                    {!unavailable ? (
                        <button onClick={guide.retry}>{t('Refresh guide')}</button>
                    ) : null}
                </div>
            </footer>
        </>
    );
}
