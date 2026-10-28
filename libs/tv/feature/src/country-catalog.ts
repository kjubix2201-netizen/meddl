import { categoryCountry, DEFAULT_PREFERRED_REGION } from '@meddl/shared/m3u-utils';
import type { Category } from '@meddl/tv/util';
import type { Route } from './navigation';

/** Every category, regardless of country. */
export const ALL_COUNTRIES = 'all';
/** Categories without a recognisable country tag ("SPORT", "4K", …). */
export const OTHER_COUNTRY = 'other';

export function categoryCountryCode(name: string): string {
    return categoryCountry(name) ?? OTHER_COUNTRY;
}

/** Live TV, Movies and Series first ask for a country. */
export function needsCountry(route: Route): boolean {
    return (
        (route.view === 'live' ||
            route.view === 'movies' ||
            route.view === 'series') &&
        !route.country
    );
}

export function categoriesOfCountry(
    categories: readonly Category[],
    country: string
): Category[] {
    if (!country || country === ALL_COUNTRIES) return [...categories];
    return categories.filter(
        (category) => categoryCountryCode(category.name) === country
    );
}

export interface CountryGroup {
    code: string;
    categories: number;
    /** Titles; undefined when the provider does not report counts. */
    titles?: number;
}

/**
 * Countries present in a source, the viewer's region (Germany) first, then
 * by size; categories without a country and "all" close the list.
 */
export function countryGroups(
    categories: readonly Category[],
    counts?: Record<string, number>
): CountryGroup[] {
    const groups = new Map<string, CountryGroup>();
    for (const category of categories) {
        const code = categoryCountryCode(category.name);
        const group = groups.get(code) ?? {
            code,
            categories: 0,
            titles: counts ? 0 : undefined,
        };
        group.categories += 1;
        if (counts && group.titles !== undefined)
            group.titles += counts[category.id] ?? 0;
        groups.set(code, group);
    }
    const preferred = DEFAULT_PREFERRED_REGION.toUpperCase();
    const size = (group: CountryGroup) => group.titles ?? group.categories;
    const countries = [...groups.values()]
        .filter((group) => group.code !== OTHER_COUNTRY)
        .filter((group) => group.titles !== 0)
        .sort(
            (a, b) =>
                Number(b.code === preferred) - Number(a.code === preferred) ||
                size(b) - size(a) ||
                a.code.localeCompare(b.code)
        );
    const other = groups.get(OTHER_COUNTRY);
    const total = counts
        ? Object.values(counts).reduce((sum, value) => sum + value, 0)
        : undefined;
    return [
        ...countries,
        ...(other && other.titles !== 0 ? [other] : []),
        { code: ALL_COUNTRIES, categories: categories.length, titles: total },
    ];
}
