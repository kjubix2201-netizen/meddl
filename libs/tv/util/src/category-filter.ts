/**
 * A catalog request may name several categories at once (all categories of
 * one country). They travel in the existing `category` string, joined with a
 * control character no provider uses in ids, so the provider interface stays
 * the same and single ids keep working unchanged.
 */
export const CATEGORY_LIST_SEPARATOR = '\u001f';
/** Matches nothing: a country whose categories are all gone. */
export const NO_CATEGORY = '\u001f\u001f';
/**
 * "Trending this week" at the top of the Movies and Series categories: not a
 * provider category but TMDB's list, matched with the source's titles
 * (top-catalog.ts). A provider asked for it by mistake answers empty.
 */
export const TOP_CATEGORY = '\u001etop';

export function joinCategories(ids: readonly string[]): string {
    if (!ids.length) return NO_CATEGORY;
    return ids.length === 1 ? ids[0] : ids.join(CATEGORY_LIST_SEPARATOR);
}

/** Predicate for item category ids; '' means every category. */
export function categoryFilter(category: string): (id?: string) => boolean {
    if (!category) return () => true;
    if (!category.includes(CATEGORY_LIST_SEPARATOR))
        return (id) => id === category;
    const wanted = new Set(category.split(CATEGORY_LIST_SEPARATOR).filter(Boolean));
    return (id) => id !== undefined && wanted.has(id);
}

/** Titles per category id, for the country picker counts. */
export function countByCategory(
    items: readonly { category?: string }[]
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
        const id = item.category ?? '';
        counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
}
