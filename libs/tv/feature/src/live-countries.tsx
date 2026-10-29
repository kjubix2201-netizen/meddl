import { useEffect, useMemo, useRef } from 'preact/hooks';
import { TvIcon, focusKey, restoreFocus } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import { countryGroups, type CountryGroup } from './country-catalog';
import { CountryFlag, countryKey, countryLabel } from './country-picker';
import { categoryKey } from './use-live-browse';
import type { TvModel } from './use-tv';

const isBack = (event: KeyboardEvent) =>
    event.keyCode === 461 || ['Escape', 'BrowserBack', 'Backspace'].includes(event.key);

/**
 * Live TV, left edge: the countries as a drawer. Without a chosen country it
 * is open and the rest of the page waits; after choosing one it slides away
 * and only an arrow stays. Moving left onto the arrow (remote: ◀) opens it
 * again, moving right or Back closes it without changing the country.
 */
export function LiveCountries({
    tv,
    open,
    setOpen,
}: {
    tv: TvModel;
    open: boolean;
    setOpen: (open: boolean) => void;
}) {
    const route = tv.route;
    const picking = !route.country;
    const expanded = picking || open;
    const all = tv.catalog.allCategories ?? tv.catalog.categories;
    const counts = tv.catalog.categoryCounts;
    const computed = useMemo<CountryGroup[]>(() => (all.length ? countryGroups(all, counts) : []), [all, counts]);
    // While a country's channels load the catalog is briefly empty: keep the last list.
    const kept = useRef<CountryGroup[]>([]);
    if (computed.length) kept.current = computed;
    const groups = computed.length ? computed : kept.current;
    const drawer = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!expanded || !groups.length) return;
        const current = focusKey();
        if (current.startsWith('country:')) return;
        // First visit: the country list takes focus unless a return target is pending.
        if (picking && tv.restoreKey && !current.startsWith('live-countries')) return;
        restoreFocus(countryKey(route.country || groups[0].code), countryKey(groups[0].code));
    }, [expanded, groups.length]);

    function close() {
        setOpen(false);
        restoreFocus(categoryKey(route.category), categoryKey(''));
    }
    function choose(code: string) {
        setOpen(false);
        if (code === route.country) {
            restoreFocus(categoryKey(route.category), categoryKey(''));
            return;
        }
        tv.visit({ ...route, country: code, category: '', page: 0, query: '' }, categoryKey(''));
    }

    if (!expanded)
        return (
            <nav class="live-countries is-closed" aria-label={t('Countries')}>
                <button
                    class="live-countries-tab"
                    data-focus="live-countries"
                    aria-label={t('Countries')}
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                >
                    <span class="live-countries-arrow" aria-hidden="true">
                        <TvIcon name="back" />
                    </span>
                </button>
            </nav>
        );

    return (
        <nav
            ref={drawer}
            class={`live-countries is-open ${picking ? 'is-picking' : ''}`}
            aria-label={t('Choose a country')}
            onFocusOut={() =>
                requestAnimationFrame(() => {
                    // Focus moved on to the categories: slide the drawer away.
                    if (!picking && drawer.current && !drawer.current.contains(document.activeElement)) setOpen(false);
                })
            }
            onKeyDown={(event) => {
                if (!picking && isBack(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                }
            }}
        >
            <div class="live-countries-list" role="list">
                {groups.map((group) => (
                    <button
                        key={group.code}
                        role="listitem"
                        class="country-row"
                        data-focus={countryKey(group.code)}
                        aria-pressed={group.code === route.country}
                        onClick={() => choose(group.code)}
                    >
                        <CountryFlag code={group.code} />
                        <span class="country-copy">
                            <strong>{countryLabel(group.code)}</strong>
                        </span>
                    </button>
                ))}
                {!groups.length ? (
                    <p class="muted" role="status">
                        {tv.catalogBusy || tv.busy ? t('Loading countries…') : tv.catalogError || t('This source has no categories here yet.')}
                    </p>
                ) : null}
            </div>
        </nav>
    );
}
