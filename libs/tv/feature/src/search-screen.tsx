import { useEffect, useState } from 'preact/hooks';
import { Empty, Poster } from '@meddl/tv/ui';
import { t, tn, type Kind, type Media } from '@meddl/tv/util';
import type { TvModel } from './use-tv';

const KINDS: [Kind, string][] = [
    ['movie', 'Movies'],
    ['series', 'Series'],
    ['live', 'Live TV'],
];
const PER_KIND = 18;

interface Results {
    query: string;
    rows: { kind: Kind; items: Media[]; total: number }[];
    busy: boolean;
}

/**
 * Search: one field for everything. Films, series and channels of the
 * active source are searched together and shown in a row each, so there is
 * no content type to pick first.
 */
export function SearchScreen({ tv }: { tv: TvModel }) {
    const r = tv.route;
    const query = r.query.trim();
    const [results, setResults] = useState<Results>({ query: '', rows: [], busy: false });
    const client = tv.guideClient;

    useEffect(() => {
        if (!client || query.length < 2) {
            setResults({ query, rows: [], busy: false });
            return;
        }
        const abort = new AbortController();
        setResults((previous) => ({ ...previous, query, busy: true }));
        // A short pause while typing, then one kind after the other: the
        // provider is asked three times at most per search, not per key.
        const timer = setTimeout(async () => {
            const rows: Results['rows'] = [];
            for (const [kind] of KINDS) {
                const allowed =
                    kind === 'movie' ? client.capabilities.movies : kind === 'series' ? client.capabilities.series : client.capabilities.live;
                if (!allowed) continue;
                try {
                    const found = await client.catalog(kind, '', 0, query, abort.signal, 'title');
                    if (abort.signal.aborted) return;
                    if (found.total) rows.push({ kind, items: found.items.slice(0, PER_KIND), total: found.total });
                    setResults({ query, rows: [...rows], busy: true });
                } catch {
                    if (abort.signal.aborted) return;
                }
            }
            if (!abort.signal.aborted) setResults({ query, rows, busy: false });
        }, 300);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [client, query]);

    return (
        <>
            <div class="catalog-filters">
                <label class="search-field">
                    {t('Search films, series and channels')}
                    <input
                        type="search"
                        data-focus="search:query"
                        aria-label={t('Search films, series and channels')}
                        value={r.query}
                        onInput={(e) => tv.setRoute({ ...r, query: e.currentTarget.value, page: 0 })}
                    />
                </label>
            </div>
            {query.length < 2 ? (
                <Empty icon="search">{t('Type at least two letters to search films, series and channels.')}</Empty>
            ) : null}
            {results.rows.map(({ kind, items, total }) => (
                <section class="search-results">
                    <h2>
                        {t(KINDS.find(([k]) => k === kind)![1])}{' '}
                        <span class="catalog-count">
                            {kind === 'live'
                                ? tn(total, '{count} channel', '{count} channels')
                                : tn(total, '{count} title', '{count} titles')}
                        </span>
                    </h2>
                    <div class="rail">
                        {items.map((item) => (
                            <Poster key={item.id} item={item} open={tv.open} />
                        ))}
                    </div>
                </section>
            ))}
            {query.length >= 2 && results.busy ? <p class="muted search-busy">{t('Searching…')}</p> : null}
            {query.length >= 2 && !results.busy && results.query === query && !results.rows.length ? (
                <Empty icon="search">{t('Nothing found for “{query}”.', { query })}</Empty>
            ) : null}
        </>
    );
}
