import { useEffect, useMemo, useRef } from 'preact/hooks';
import { TvIcon, focusKey, restoreFocus } from '@meddl/tv/ui';
import { t } from '@meddl/tv/util';
import { ALL_COUNTRIES, OTHER_COUNTRY, countryGroups, type CountryGroup } from './country-catalog';
import { CountryFlag, countryKey, countryLabel } from './country-picker';
import { startCategory } from './top-catalog';
import type { TvModel } from './use-tv';

const isBack = (event: KeyboardEvent) =>
    event.keyCode === 461 || ['Escape', 'BrowserBack', 'Backspace'].includes(event.key);

/**
 * Live TV, Movies and Series, left edge: the countries as a drawer. Without a
 * chosen country it is open and the rest of the page waits; after choosing
 * one it slides away and only an arrow stays. Moving left onto the arrow
 * (remote: ◀) opens it again, moving right or Back closes it without
 * changing the country.
 */
export function CountryDrawer({
    tv,
    open,
    setOpen,
    focusAfter,
    focusFallback = '',
}: {
    tv: TvModel;
    open: boolean;
    setOpen: (open: boolean) => void;
    /** Where focus goes after choosing or closing (the page's first list). */
    focusAfter: string;
    focusFallback?: string;
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
    // Where the viewer came from when opening it with ◀: Back returns there.
    const returnTo = useRef('');

    useEffect(() => {
        if (!expanded || !groups.length) return;
        const current = focusKey();
        if (current.startsWith('country:')) return;
        // First visit: the country list takes focus unless a return target is pending.
        if (picking && tv.restoreKey && current !== 'country-drawer') return;
        restoreFocus(countryKey(route.country || groups[0].code), countryKey(groups[0].code));
    }, [expanded, groups.length]);

    // The source has no categories for this country (e.g. the default, Germany): offer the list.
    useEffect(() => {
        if (picking || open || !computed.length) return;
        if (route.country === ALL_COUNTRIES || route.country === OTHER_COUNTRY) return;
        if (!computed.some((group) => group.code === route.country)) setOpen(true);
    }, [computed, route.country]);

    function close() {
        setOpen(false);
        restoreFocus(returnTo.current || focusAfter, focusFallback);
    }
    function choose(code: string) {
        setOpen(false);
        if (code === route.country) {
            restoreFocus(focusAfter, focusFallback);
            return;
        }
        tv.visit(
            { ...route, country: code, category: startCategory(route.kind, tv.data.tmdb), page: 0, query: '' },
            focusFallback || focusAfter
        );
    }

    if (!expanded)
        return (
            <nav class="country-drawer is-closed" aria-label={t('Countries')}>
                <button
                    class="country-drawer-tab"
                    data-focus="country-drawer"
                    aria-label={t('Countries')}
                    onFocus={(event) => {
                        returnTo.current = (event.relatedTarget as HTMLElement | null)?.dataset?.focus ?? '';
                        // Remote or keyboard (◀) opens at once; with the mouse
                        // (focus follows the pointer in the Windows app) only
                        // a click does.
                        if (!(event.currentTarget as HTMLElement).matches(':hover')) setOpen(true);
                    }}
                    onClick={() => setOpen(true)}
                >
                    <span class="country-drawer-arrow" aria-hidden="true">
                        <TvIcon name="back" />
                    </span>
                </button>
            </nav>
        );

    return (
        <nav
            ref={drawer}
            class={`country-drawer is-open ${picking ? 'is-picking' : ''}`}
            aria-label={t('Choose a country')}
            onFocusOut={() =>
                requestAnimationFrame(() => {
                    // Focus moved on to the page (categories, titles): slide the drawer away.
                    // Not while focus is nowhere – that is the arrow being replaced by the list.
                    const active = document.activeElement;
                    if (
                        !picking &&
                        drawer.current &&
                        active &&
                        active !== document.body &&
                        !drawer.current.contains(active)
                    )
                        setOpen(false);
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
            <div class="country-drawer-list" role="list">
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
