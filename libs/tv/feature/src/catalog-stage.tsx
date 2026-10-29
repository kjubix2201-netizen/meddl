import { useState } from 'preact/hooks';
import { TvIcon } from '@meddl/tv/ui';
import { t, tn } from '@meddl/tv/util';
import { ALL_COUNTRIES } from './country-catalog';
import { countryLabel } from './country-picker';
import { CountryDrawer } from './country-drawer';
import { CatalogScreen } from './screens';
import type { TvModel } from './use-tv';

/**
 * Movies and Series, as on the Live TV page: no menu bar, back and the title
 * at the top left, the countries as a drawer at the left edge (open until a
 * country is chosen, then only an arrow), the catalog beside it.
 */
export function CatalogStage({ tv }: { tv: TvModel }) {
    const route = tv.route;
    const [open, setOpen] = useState(false);
    const picking = !route.country;
    const country = route.country && route.country !== ALL_COUNTRIES ? countryLabel(route.country) : '';
    const title = route.view === 'series' ? t('Series') : t('Movies');
    return (
        <div class={`catalog-stage${picking ? ' picks-country' : open ? ' countries-open' : ''}`}>
            <header class="catalog-title">
                <button class="round" data-focus="catalog-back" aria-label={t('Back')} onClick={tv.back}>
                    <TvIcon name="back" />
                </button>
                <span class="catalog-title-copy">
                    <strong>{title}</strong>
                    {picking ? (
                        <small>{t('Choose a country')}</small>
                    ) : (
                        <small>
                            {country ? `${country} · ` : ''}
                            {tv.catalogBusy && !tv.catalog.total
                                ? ''
                                : route.kind === 'series'
                                  ? tn(tv.catalog.total, '{count} series', '{count} series')
                                  : tn(tv.catalog.total, '{count} title', '{count} titles')}
                        </small>
                    )}
                </span>
            </header>
            <CountryDrawer tv={tv} open={open} setOpen={setOpen} focusAfter="catalog:category" />
            <section class="catalog-stage-content" hidden={picking}>
                <CatalogScreen tv={tv} />
            </section>
        </div>
    );
}
