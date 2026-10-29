import { TvModel } from './use-tv';
import { favoritesFor } from './favorites';
import { t, tn } from '@meddl/tv/util';
import { ALL_COUNTRIES, needsCountry } from './country-catalog';
import { CountryFlag, countryLabel } from './country-picker';
export function PageHeader({ tv }: { tv: TvModel }) {
    const view = tv.route.view;
    // Home is the full-screen launcher; sources are switched on Sources.
    if (view === 'home') return null;
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
    // The country picker shows its own heading.
    const picking = needsCountry(tv.route);
    const country =
        !picking && view !== 'live' && tv.route.country && tv.route.country !== ALL_COUNTRIES
            ? tv.route.country
            : '';
    const count =
        view === 'favorites'
            ? favoritesFor(tv, tv.route.kind).length
            : ['movies', 'series', 'live'].includes(view)
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
                    {title && !picking ? <h1>{title}</h1> : null}
                    {country ? (
                        <span class="country-chip">
                            <CountryFlag code={country} />
                            {countryLabel(country)}
                        </span>
                    ) : null}
                    {count !== undefined && view !== 'live' && !picking ? (
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
