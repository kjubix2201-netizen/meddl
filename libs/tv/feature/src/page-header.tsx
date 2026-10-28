import { TvModel } from './use-tv';
import { favoritesFor } from './favorites';
import { t, tn } from '@meddl/tv/util';
export function PageHeader({ tv }: { tv: TvModel }) {
    const view = tv.route.view;
    const title = {
        movies: t('Movies'),
        series: t('Series'),
        favorites: t('Favorites'),
        search: t('Find your next story.'),
        // The Live TV page titles its category column instead.
        live: '',
        sources: t('Sources'),
        settings: t('Settings'),
        home: '',
        detail: '',
        person: '',
    }[view];
    const count =
        view === 'favorites'
            ? favoritesFor(tv, tv.route.kind).length
            : ['movies', 'series', 'search', 'live'].includes(view)
              ? tv.catalog.total
              : undefined;
    return (
        <header class="page-header">
            {view === 'detail' || view === 'person' ? (
                <button
                    data-focus={
                        view === 'person' ? 'person-back' : 'detail-back'
                    }
                    onClick={tv.back}
                >
                    ← {t('Back')}
                </button>
            ) : (
                <div class="page-heading">
                    {title ? <h1>{title}</h1> : null}
                    {count !== undefined && view !== 'live' ? (
                        <span class="catalog-count">
                            {tv.route.kind === 'live'
                                ? tn(count, '{count} channel', '{count} channels')
                                : tn(count, '{count} title', '{count} titles')}
                        </span>
                    ) : null}
                </div>
            )}
            <select
                aria-label={t('Active source')}
                value={tv.data.activeId}
                onChange={(event) => {
                    void tv.switchSource(event.currentTarget.value);
                }}
            >
                {!tv.data.sources.length ? (
                    <option value="">{t('No source connected')}</option>
                ) : null}
                {tv.data.sources.map((s) => (
                    <option value={s.id}>
                        {s.name} · {s.provider.toUpperCase()}
                    </option>
                ))}
            </select>
        </header>
    );
}
