const CATEGORY_SORT_COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export type PortalCategorySortMode = 'server' | 'name-asc' | 'name-desc';

export const DEFAULT_PORTAL_CATEGORY_SORT_MODE: PortalCategorySortMode =
    'server';

export const WORKSPACE_CATEGORY_SORT_STORAGE_KEY =
    'workspace-category-sort-mode';

export function isPortalCategorySortMode(
    value: unknown
): value is PortalCategorySortMode {
    return value === 'server' || value === 'name-asc' || value === 'name-desc';
}

export function restorePortalCategorySortMode(
    storageKey: string = WORKSPACE_CATEGORY_SORT_STORAGE_KEY,
    fallback: PortalCategorySortMode = DEFAULT_PORTAL_CATEGORY_SORT_MODE
): PortalCategorySortMode {
    const storedValue = localStorage.getItem(storageKey);
    return isPortalCategorySortMode(storedValue) ? storedValue : fallback;
}

export function persistPortalCategorySortMode(
    mode: PortalCategorySortMode,
    storageKey: string = WORKSPACE_CATEGORY_SORT_STORAGE_KEY
): void {
    localStorage.setItem(storageKey, mode);
}

/**
 * Sorts a category list. Order: pinned items ("All"), then preferred items
 * (the viewer's region, see `matchesPreferredRegion`), then the rest. Each
 * group follows `mode`; `server` keeps the provider's order inside groups.
 */
export function sortPortalCategoryItems<T>(
    items: readonly T[],
    mode: PortalCategorySortMode,
    getDisplayName: (item: T) => string | null | undefined,
    isPinnedFirst: (item: T) => boolean = () => false,
    isPreferred: ((item: T) => boolean) | null = null
): readonly T[] {
    if (mode === 'server' && !isPreferred) {
        return items;
    }

    const pinnedItems = items.filter(isPinnedFirst);
    const sortableItems = items.filter((item) => !isPinnedFirst(item));
    const sortGroup = (group: T[]): T[] =>
        mode === 'server'
            ? group
            : group.sort((a, b) => {
                  const result = CATEGORY_SORT_COLLATOR.compare(
                      (getDisplayName(a) ?? '').trim(),
                      (getDisplayName(b) ?? '').trim()
                  );
                  return mode === 'name-asc' ? result : -result;
              });

    if (!isPreferred) {
        return pinnedItems.concat(sortGroup(sortableItems));
    }
    const preferredItems = sortableItems.filter(isPreferred);
    const otherItems = sortableItems.filter((item) => !isPreferred(item));
    return pinnedItems.concat(
        sortGroup(preferredItems),
        sortGroup(otherItems)
    );
}
