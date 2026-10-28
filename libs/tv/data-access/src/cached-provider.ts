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
    get(key: string, load: () => Promise<T>): Promise<T> {
        const hit = this.entries.get(key);
        if (hit && Date.now() - hit.at < this.ttl) return hit.value;
        const value = load();
        this.entries.set(key, { value, at: Date.now() });
        // Failures are not kept: the next visit asks the provider again.
        value.catch(() => {
            if (this.entries.get(key)?.value === value) this.entries.delete(key);
        });
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
    constructor(private inner: ProviderClient) {}
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
            this.catalogs.get(key, () =>
                this.inner.catalog(kind, category, page, query, this.owner.signal, sort)
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
    /** Loads the first page of every section in the background. */
    async warm(sorts: { movie: CatalogSort; series: CatalogSort }) {
        const kinds: [Kind, boolean, CatalogSort][] = [
            ['live', this.capabilities.live, 'provider'],
            ['movie', this.capabilities.movies, sorts.movie],
            ['series', this.capabilities.series, sorts.series],
        ];
        for (const [kind, supported, sort] of kinds) {
            if (!supported || this.owner.signal.aborted) continue;
            await this.catalog(kind, '', 0, '', this.owner.signal, sort).catch(() => undefined);
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
