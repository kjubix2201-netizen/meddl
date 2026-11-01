/**
 * Keeps the provider's complete lists (channels, films, series and their
 * categories) on this device, so the app does not download tens of
 * thousands of entries on every start. Lists younger than the chosen
 * interval (24 hours by default, Settings → Library) are used as they are.
 * Older ones are fetched again; if the provider then answers empty or not
 * at all, the last good list is used instead of an empty section.
 *
 * Its own database next to the user data (storage.ts), so a damaged or
 * cleared cache never touches favourites or viewing progress.
 */
const DATABASE = 'meddl-tv-catalog-cache';
const STORE = 'lists';
const INTERVAL_KEY = 'meddl-catalog-refresh-hours';
export const CATALOG_REFRESH_CHOICES = [0, 6, 24, 72] as const;

interface Entry {
    at: number;
    rows: unknown[];
}

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    // Ask to keep the lists when the device runs low on space (TVs often
    // do); without it the browser may clear them and every start downloads.
    if (!opening)
        try {
            void navigator.storage?.persist?.().catch(() => undefined);
        } catch {
            // Not offered here.
        }
    opening ??= new Promise((resolve) => {
        try {
            const request = indexedDB.open(DATABASE, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return opening;
}

/** Hours between downloads of the full lists; 0 means on every start. */
export function catalogRefreshHours(): number {
    try {
        const saved = Number(localStorage.getItem(INTERVAL_KEY));
        return localStorage.getItem(INTERVAL_KEY) !== null && Number.isFinite(saved) && saved >= 0 ? saved : 24;
    } catch {
        return 24;
    }
}

export function setCatalogRefreshHours(hours: number) {
    try {
        localStorage.setItem(INTERVAL_KEY, String(hours));
    } catch {
        // Applies for this session only.
    }
}

export async function readCachedList(key: string): Promise<Entry | undefined> {
    const db = await database();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            request.onsuccess = () => {
                const value = request.result as Entry | undefined;
                resolve(value && Array.isArray(value.rows) && Number.isFinite(value.at) ? value : undefined);
            };
            request.onerror = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

export async function writeCachedList(key: string, rows: unknown[]): Promise<void> {
    const db = await database();
    if (!db || !rows.length) return;
    await new Promise<void>((resolve) => {
        try {
            const transaction = db.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).put({ at: Date.now(), rows } satisfies Entry, key);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        } catch {
            resolve();
        }
    });
}

/** "Reload now": the next start or connection downloads everything again. */
export async function clearCatalogCache(): Promise<void> {
    const db = await database();
    if (!db) return;
    await new Promise<void>((resolve) => {
        try {
            const transaction = db.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => resolve();
        } catch {
            resolve();
        }
    });
}

/** Where a list came from: kept on this device, or downloaded now. */
export type ListOrigin = 'device' | 'provider';
const originListeners = new Set<(origin: ListOrigin) => void>();
/** Hears whether lists come from this device or the provider (start-up window). */
export function onListOrigin(listener: (origin: ListOrigin) => void): () => void {
    originListeners.add(listener);
    return () => originListeners.delete(listener);
}
function reportOrigin(origin: ListOrigin) {
    originListeners.forEach((listener) => {
        try {
            listener(origin);
        } catch {
            // A listener's failure never breaks loading.
        }
    });
}

/**
 * The list under `key`: from this device while it is fresh enough,
 * otherwise from `load`, falling back to the last good list when the
 * provider answers empty or fails.
 */
export async function cachedList<T>(key: string, load: () => Promise<T[]>, signal: AbortSignal): Promise<T[]> {
    const cached = await readCachedList(key);
    const hours = catalogRefreshHours();
    if (cached && hours > 0) {
        // Like other IPTV players: the saved list opens at once; an outdated
        // one is downloaded again in the background for the next start.
        if (Date.now() - cached.at >= hours * 3_600_000) refreshLater(key, load, signal);
        reportOrigin('device');
        return cached.rows as T[];
    }
    reportOrigin('provider');
    try {
        const fresh = await load();
        if (fresh.length) {
            void writeCachedList(key, fresh);
            return fresh;
        }
        return cached && !signal.aborted ? (cached.rows as T[]) : fresh;
    } catch (error) {
        if (cached && !signal.aborted) return cached.rows as T[];
        throw error;
    }
}

const refreshing = new Set<string>();

/** Downloads an outdated list quietly after the start has settled. */
function refreshLater<T>(key: string, load: () => Promise<T[]>, signal: AbortSignal) {
    if (refreshing.has(key)) return;
    refreshing.add(key);
    const timer = setTimeout(() => {
        if (signal.aborted) return void refreshing.delete(key);
        load()
            .then((fresh) => (fresh.length && !signal.aborted ? writeCachedList(key, fresh) : undefined))
            .catch(() => undefined)
            .finally(() => refreshing.delete(key));
    }, 20000);
    signal.addEventListener(
        'abort',
        () => {
            clearTimeout(timer);
            refreshing.delete(key);
        },
        { once: true }
    );
}
