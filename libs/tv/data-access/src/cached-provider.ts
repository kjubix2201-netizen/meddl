import type {
    Catalog,
    CatalogSort,
    Kind,
    Media,
    Playback,
    Program,
    ProviderClient,
    Source,
} from '@meddl/tv/util';

const MAX_CATALOGS = 300;
const MAX_ITEMS = 500;
const EPG_MS = 5 * 60 * 1000;

/** Resolves with `work`, or rejects as soon as the caller's signal aborts. */
function race<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        work.then(
            (value) => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', abort);
                reject(error);
            }
        );
    });
}

/** Small insertion-ordered cache; the oldest entry leaves first. */
class Store<T> {
    private entries = new Map<string, { value: Promise<T>; at: number }>();
    constructor(
        private limit: number,
        private ttl = Infinity
    ) {}
    get(key: string, load: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
        const hit = this.entries.get(key);
        if (hit && Date.now() - hit.at < this.ttl) return hit.value;
        const value = load();
        this.entries.set(key, { value, at: Date.now() });
        // Failures are not kept: the next visit asks the provider again.
        const forget = () => {
            if (this.entries.get(key)?.value === value) this.entries.delete(key);
        };
        value.then((result) => {
            if (!keep(result)) forget();
        }, forget);
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
        return value;
    }
    clear() {
        this.entries.clear();
    }
}

/**
 * Keeps what a source already delivered for the whole session: switching
 * tabs, countries or categories answers from memory instead of asking the
 * provider again. Requests in flight are shared, and they finish in the
 * background when the screen that asked moves on, so the next visit is
 * instant. A new connection (source change, retry) starts a fresh cache.
 */
export class CachedProvider implements ProviderClient {
    private readonly owner = new AbortController();
    private catalogs = new Store<Catalog>(MAX_CATALOGS);
    private details_ = new Store<Media>(MAX_ITEMS);
    private episodes_ = new Store<Media[]>(MAX_ITEMS);
    private guide = new Store<Program[]>(MAX_ITEMS, EPG_MS);
    // Catalog requests reach the provider one at a time: panels often throttle
    // or answer empty when several large lists are requested at once.
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private inner: ProviderClient) {}
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work);
        this.queue = run.catch(() => undefined);
        return run;
    }
    get capabilities() {
        return this.inner.capabilities;
    }
    connect(signal: AbortSignal): Promise<Source> {
        return this.inner.connect(signal);
    }
    catalog(
        kind: Kind,
        category: string,
        page: number,
        query: string,
        signal: AbortSignal,
        sort: CatalogSort = 'recent'
    ): Promise<Catalog> {
        const key = JSON.stringify([kind, category, page, query.trim(), sort]);
        return race(
            this.catalogs.get(
                key,
                () =>
                    this.serial(() =>
                        this.inner.catalog(kind, category, page, query, this.owner.signal, sort)
                    ),
                // Nothing at all (no titles, no categories) is not remembered.
                (result) => result.total > 0 || result.categories.length > 0
            ),
            signal
        );
    }
    details(item: Media, signal: AbortSignal): Promise<Media> {
        return race(
            this.details_.get(item.id, () => this.inner.details(item, this.owner.signal)),
            signal
        );
    }
    episodes(item: Media, signal: AbortSignal): Promise<Media[]> {
        return race(
            this.episodes_.get(item.id, () => this.inner.episodes(item, this.owner.signal)),
            signal
        );
    }
    epg(item: Media, signal: AbortSignal): Promise<Program[]> {
        return race(
            this.guide.get(item.id, () => this.inner.epg(item, this.owner.signal)),
            signal
        );
    }
    /** Stream links expire on many providers: always resolved fresh. */
    resolve(item: Media, signal: AbortSignal): Promise<Playback> {
        return this.inner.resolve(item, signal);
    }
    /** Sections this source offers, in loading order. */
    warmKinds(): Kind[] {
        const kinds: [Kind, boolean][] = [
            ['live', this.capabilities.live],
            ['movie', this.capabilities.movies],
            ['series', this.capabilities.series],
        ];
        return kinds.filter(([, supported]) => supported).map(([kind]) => kind);
    }
    /**
     * Loads the first page of every section, one after the other, and
     * reports each step (with the number of titles once loaded).
     */
    async warm(
        sorts: { movie: CatalogSort; series: CatalogSort },
        onStep: (kind: Kind, state: 'loading' | 'done' | 'failed', total?: number) => void = () => undefined
    ) {
        for (const kind of this.warmKinds()) {
            if (this.owner.signal.aborted) return;
            const sort = kind === 'live' ? 'provider' : sorts[kind === 'movie' ? 'movie' : 'series'];
            onStep(kind, 'loading');
            try {
                const result = await this.catalog(kind, '', 0, '', this.owner.signal, sort);
                onStep(kind, 'done', result.total);
            } catch {
                onStep(kind, 'failed');
            }
        }
    }
    dispose() {
        this.owner.abort();
        this.catalogs.clear();
        this.details_.clear();
        this.episodes_.clear();
        this.guide.clear();
        this.inner.dispose();
    }
}
