import { useEffect, useMemo } from 'preact/hooks';
import { Empty, Flag, TvIcon, focusKey, restoreFocus } from '@meddl/tv/ui';
import { countryName, t, tn, type Kind } from '@meddl/tv/util';
import {
    ALL_COUNTRIES,
    OTHER_COUNTRY,
    countryGroups,
    type CountryGroup,
} from './country-catalog';
import { categoryKey } from './use-live-browse';
import type { TvModel } from './use-tv';

export const countryKey = (code: string) => `country:${code}`;

export function countryLabel(code: string): string {
    if (code === ALL_COUNTRIES) return t('All countries');
    if (code === OTHER_COUNTRY) return t('More categories');
    return countryName(code);
}

export function CountryFlag({ code }: { code: string }) {
    if (code === ALL_COUNTRIES)
        return (
            <span class="flag flag-generic">
                <TvIcon name="globe" />
            </span>
        );
    return <Flag country={code === OTHER_COUNTRY ? null : code} />;
}

function countLabel(group: CountryGroup, kind: Kind) {
    if (group.titles === undefined)
        return tn(group.categories, '{count} category', '{count} categories');
    if (kind === 'live')
        return tn(group.titles, '{count} channel', '{count} channels');
    if (kind === 'series')
        return tn(group.titles, '{count} series', '{count} series');
    return tn(group.titles, '{count} title', '{count} titles');
}

/**
 * First step of Live TV, Movies and Series: the countries found in the
 * source's categories, Germany on top. Choosing one shows only that
 * country's categories, and searches stay inside it.
 */
export function CountryPicker({ tv }: { tv: TvModel }) {
    const route = tv.route;
    const { categories, categoryCounts } = tv.catalog;
    const groups = useMemo(
        () => (categories.length ? countryGroups(categories, categoryCounts) : []),
        [categories, categoryCounts]
    );
    const title =
        route.view === 'live'
            ? t('Live TV')
            : route.view === 'series'
              ? t('Series')
              : t('Movies');
    useEffect(() => {
        if (!groups.length || tv.restoreKey) return;
        const current = focusKey();
        if (!current || current.startsWith('nav:'))
            restoreFocus(countryKey(groups[0].code));
    }, [groups.length]);
    function choose(code: string) {
        tv.visit(
            { ...route, country: code, category: '', page: 0, query: '' },
            route.view === 'live' ? categoryKey('') : 'catalog:category'
        );
    }
    return (
        <section class="country-picker" aria-label={t('Choose a country')}>
            <header class="country-picker-header">
                <h1>{title}</h1>
                <p class="muted">{t('Choose a country')}</p>
            </header>
            {groups.length ? (
                <div class="country-list" role="list">
                    {groups.map((group) => (
                        <button
                            key={group.code}
                            role="listitem"
                            class="country-row"
                            data-focus={countryKey(group.code)}
                            onClick={() => choose(group.code)}
                        >
                            <CountryFlag code={group.code} />
                            <span class="country-copy">
                                <strong>{countryLabel(group.code)}</strong>
                                <small>{countLabel(group, route.kind)}</small>
                            </span>
                        </button>
                    ))}
                </div>
            ) : tv.catalogBusy || tv.busy ? (
                <p class="muted" role="status">
                    {t('Loading countries…')}
                </p>
            ) : (
                <Empty>
                    {tv.catalogError ||
                        t('This source has no categories here yet.')}
                </Empty>
            )}
        </section>
    );
}
