import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CachedProvider,
    createProvider,
    findNewTopTitles,
    findTopTitles,
    ProviderTransport,
    type TvMetadata,
} from '@meddl/tv/data-access';
import { topCatalog, topListAvailable } from '../feature/src/top-catalog';
import type { Catalog, Media, ProviderClient, Source } from '@meddl/tv/util';

const signal = new AbortController().signal;
const credit = (tmdbId: number, title: string, year: number | null, originalTitle?: string) => ({
    tmdbId,
    mediaType: 'movie' as const,
    title,
    originalTitle,
    year,
    posterUrl: null,
    character: null,
    crewJob: null,
});
const films = [
    { stream_id: 1, name: 'Dune: Part Two (2024)', year: '2024', category_id: 'de' },
    { stream_id: 2, name: 'Nosferatu (1922)', year: '1922', category_id: 'de' },
    { stream_id: 3, name: 'Der Wilde Roboter', year: '2024', category_id: 'de' },
    { stream_id: 4, name: 'Gladiator II', year: '2024', category_id: 'en' },
    { stream_id: 5, name: 'Gladiator II', year: '2024', category_id: 'de' },
    { stream_id: 6, name: 'Something Else', year: '2020', category_id: 'de' },
];
class Transport extends ProviderTransport {
    constructor() {
        super('https://backend.invalid');
    }
    async request(_source: Source, _route: 'xtream' | 'stalker' | 'parse', params: Record<string, string | number>) {
        return params.action === 'get_vod_streams' ? films : params.action === 'get_vod_categories' ? [{ category_id: 'de', category_name: 'DE' }] : [];
    }
}
const source: Source = { id: 'top', name: 'Fixture', provider: 'xtream', url: 'https://provider.invalid', username: 'u', password: 'p' };
const trending = [
    credit(10, 'Gladiator II', 2024),
    credit(11, 'Nosferatu', 2024),
    credit(12, 'The Wild Robot', 2024, 'Der wilde Roboter'),
    credit(13, 'Not In The Source', 2024),
    credit(14, 'Dune: Part Two', 2024),
];

test('trending titles the source offers come in TMDB order, one per title, never another year\'s film', async () => {
    const client = new CachedProvider(createProvider(source, new Transport(), async () => undefined));
    try {
        const top = await findTopTitles(client, source.id, 'movie', trending, signal);
        // Gladiator II: the first of two equal entries; Nosferatu (1922) is another film.
        assert.deepEqual(top.map((item) => item.providerId), ['4', '3', '1']);
        const german = await findTopTitles(client, source.id, 'movie', trending, signal, (item) => item.category === 'de');
        assert.deepEqual(german.map((item) => item.providerId), ['5', '3', '1']);
        assert.deepEqual(await findTopTitles(client, source.id, 'movie', [], signal), []);
        // The same title under each language's name is one entry.
        const named = [credit(12, 'The Wild Robot', 2024), credit(12, 'Der wilde Roboter', 2024, 'The Wild Robot'), credit(14, 'Dune: Part Two', 2024)];
        assert.deepEqual((await findTopTitles(client, source.id, 'movie', named, signal)).map((item) => item.providerId), ['3', '1']);
        assert.deepEqual(await findTopTitles(client, 'another-source', 'movie', trending, signal), []);
    } finally {
        client.dispose();
    }
});

test('a portal that only answers searches is asked once per title and a failed search leaves only that title out', async () => {
    const media = (id: string, title: string, year: string): Media => ({ id, sourceId: 'top', providerId: id, kind: 'movie', title, year, raw: {} });
    const queries: string[] = [];
    const portal: ProviderClient = {
        capabilities: { live: true, movies: true, series: true, epg: false },
        connect: async () => source,
        catalog: async (_kind, _category, page, query): Promise<Catalog> => {
            queries.push(query);
            if (query === 'Nosferatu') throw new Error('busy portal');
            const items = query === 'Gladiator II' ? [media('g', 'Gladiator II', '2024')] : query === 'Dune: Part Two' ? [media('d', 'Dune: Part Two', '2024')] : [];
            return { items, total: items.length, page, categories: [] };
        },
        details: async (item) => item,
        episodes: async () => [],
        epg: async () => [],
        resolve: async () => ({ url: '' }),
        dispose: () => undefined,
    };
    const top = await findTopTitles(portal, 'top', 'movie', trending, signal);
    assert.deepEqual(top.map((item) => item.id), ['g', 'd']);
    assert.ok(queries.includes('Der wilde Roboter'));
    // Another language's name is searched only while the title is missing.
    queries.length = 0;
    const named = [credit(10, 'Gladiator II', 2024), credit(10, 'Gladiator 2', 2024), credit(14, 'Dune: Teil 2', 2024), credit(14, 'Dune: Part Two', 2024)];
    assert.deepEqual((await findTopTitles(portal, 'top', 'movie', named, signal)).map((item) => item.id), ['g', 'd']);
    assert.deepEqual(queries, ['Gladiator II', 'Dune: Teil 2', 'Dune: Part Two']);
    await assert.rejects(findTopTitles(portal, 'top', 'movie', trending, AbortSignal.abort()));
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2025-10-20T12:00:00Z');
const addedDaysAgo = (days: number) => String(Math.floor((NOW - days * DAY) / 1000));
/** An Xtream source whose film list is `rows`. */
function xtream(rows: Record<string, unknown>[]) {
    class Rows extends ProviderTransport {
        constructor() {
            super('https://backend.invalid');
        }
        async request(_source: Source, _route: 'xtream' | 'stalker' | 'parse', params: Record<string, string | number>) {
            return params.action === 'get_vod_streams' ? rows : params.action === 'get_vod_categories' ? [{ category_id: 'de', category_name: 'DE' }] : [];
        }
    }
    return new CachedProvider(createProvider(source, new Rows(), async () => undefined));
}

test('without TMDB the list is what the source added in the last days, its best rated first', async () => {
    const rows = [
        ...Array.from({ length: 45 }, (_, i) => ({ stream_id: 100 + i, name: `New ${i}`, added: addedDaysAgo(1 + (i % 10)), rating: String(i % 10), category_id: i % 2 ? 'de' : 'en' })),
        { stream_id: 1, name: 'Old favourite', added: addedDaysAgo(400), rating: '9.9', category_id: 'de' },
        { stream_id: 2, name: 'Five stars', added: addedDaysAgo(2), rating: '', rating_5based: 4.9, category_id: 'de' },
    ];
    const client = xtream(rows);
    try {
        const top = await findNewTopTitles(client, source.id, 'movie', signal, undefined, NOW);
        assert.equal(top.length, 40);
        // 4.9 of 5 counts as 9.8; the old favourite is not new.
        assert.equal(top[0].title, 'Five stars');
        assert.ok(!top.some((item) => item.title === 'Old favourite'));
        const ratings = top.slice(1).map((item) => Number(item.raw.rating));
        assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
        // Equal ratings: the newer title first.
        const nines = top.filter((item) => item.raw.rating === '9').map((item) => item.addedAt);
        assert.deepEqual(nines, [...nines].sort((a, b) => (b ?? 0) - (a ?? 0)));
        const german = await findNewTopTitles(client, source.id, 'movie', signal, (item) => item.category === 'de', NOW);
        assert.ok(german.length > 0 && german.every((item) => item.category === 'de'));
    } finally {
        client.dispose();
    }
});

test('a source that adds little shows the best of its newest titles; one without dates its best rated', async () => {
    const seldom = xtream([
        { stream_id: 1, name: 'Months ago, great', added: addedDaysAgo(90), rating: '8.5', category_id: 'de' },
        { stream_id: 2, name: 'Last week, fair', added: addedDaysAgo(6), rating: '6', category_id: 'de' },
        { stream_id: 3, name: 'Yesterday, unrated', added: addedDaysAgo(1), rating: '0', category_id: 'de' },
    ]);
    const undated = xtream([
        { stream_id: 1, name: 'Unrated', category_id: 'de' },
        { stream_id: 2, name: 'Fair', rating: '6', category_id: 'de' },
        { stream_id: 3, name: 'Great', rating: '8', category_id: 'de' },
    ]);
    const bare = xtream([{ stream_id: 1, name: 'No date, no rating', category_id: 'de' }]);
    try {
        assert.deepEqual((await findNewTopTitles(seldom, source.id, 'movie', signal, undefined, NOW)).map((item) => item.providerId), ['1', '2', '3']);
        assert.deepEqual((await findNewTopTitles(undated, source.id, 'movie', signal, undefined, NOW)).map((item) => item.title), ['Great', 'Fair']);
        assert.deepEqual(await findNewTopTitles(bare, source.id, 'movie', signal, undefined, NOW), []);
    } finally {
        [seldom, undated, bare].forEach((client) => client.dispose());
    }
});

test('a portal that sorts by date itself: its newest pages, best rated first', async () => {
    const media = (id: string, rating: string): Media => ({ id, sourceId: 'top', providerId: id, kind: 'movie', title: id, raw: { rating_imdb: rating } });
    const requests: string[] = [];
    const portal: ProviderClient = {
        capabilities: { live: true, movies: true, series: true, epg: false },
        connect: async () => source,
        catalog: async (kind, category, page, query, _signal, sort): Promise<Catalog> => {
            requests.push(`${kind}:${category}:${page}:${query}:${sort}`);
            const items = page === 0 ? [media('a', '5.1'), media('b', '8.2')] : [media('c', '7'), media('a', '5.1')];
            return { items, total: 4, page, pageSize: 2, categories: [] };
        },
        details: async (item) => item,
        episodes: async () => [],
        epg: async () => [],
        resolve: async () => ({ url: '' }),
        dispose: () => undefined,
    };
    const top = await findNewTopTitles(portal, 'top', 'movie', signal);
    assert.deepEqual(top.map((item) => item.id), ['b', 'c', 'a']);
    assert.deepEqual(requests, ['movie::0::recent', 'movie::1::recent']);
});

test('the category shows TMDB\'s trends when it can and the source\'s own list otherwise', async () => {
    const rows = [
        { stream_id: 1, name: 'Dune: Part Two (2024)', year: '2024', added: addedDaysAgo(300), rating: '8', category_id: 'de' },
        { stream_id: 2, name: 'Fresh and fine', added: addedDaysAgo(3), rating: '7', category_id: 'de' },
        { stream_id: 3, name: 'Fresh and great', added: addedDaysAgo(5), rating: '9', category_id: 'en' },
    ];
    const metadata = (answer: () => Promise<ReturnType<typeof credit>[]>) => ({ trending: answer }) as unknown as TvMetadata;
    const ids = async (client: ProviderClient, tmdb?: TvMetadata, scoped?: { id: string; name: string }[], query = '') =>
        (await topCatalog(client, tmdb, source.id, 'movie', query, scoped, signal, 'recent')).items.map((item) => item.providerId);
    // Few titles, so the source's list is the best rated of its newest ones.
    // A new connection per case: the list is kept per connection.
    for (const [name, tmdb, expected] of [
        ['no key', undefined, ['3', '1', '2']],
        ['TMDB does not answer', metadata(async () => Promise.reject(new Error('offline'))), ['3', '1', '2']],
        ['none of the trends is here', metadata(async () => [credit(1, 'Not In The Source', 2024)]), ['3', '1', '2']],
        ['a trend is here', metadata(async () => [credit(14, 'Dune: Part Two', 2024)]), ['1']],
    ] as const) {
        const client = xtream(rows);
        try {
            assert.deepEqual(await ids(client, tmdb), expected, name);
        } finally {
            client.dispose();
        }
    }
    const client = xtream(rows);
    try {
        const all = await topCatalog(client, undefined, source.id, 'movie', '', undefined, signal, 'recent');
        assert.equal(all.total, 3);
        assert.deepEqual(all.categories, [{ id: 'de', name: 'DE' }]);
        assert.deepEqual(await ids(client, undefined, [{ id: 'de', name: 'DE' }]), ['1', '2']);
        assert.deepEqual(await ids(client, undefined, undefined, 'great'), ['3']);
    } finally {
        client.dispose();
    }
    // Shown without a key for sources with dates and ratings; a plain playlist needs the key.
    const settings = (provider: Source['provider'], enabled: boolean) => ({
        tmdb: { enabled, apiKey: enabled ? 'key' : '', language: 'en' },
        sources: [{ ...source, provider }],
        activeId: source.id,
    });
    assert.equal(topListAvailable('movie', settings('xtream', false)), true);
    assert.equal(topListAvailable('series', settings('stalker', false)), true);
    assert.equal(topListAvailable('movie', settings('m3u', false)), false);
    assert.equal(topListAvailable('movie', settings('m3u', true)), true);
    assert.equal(topListAvailable('live', settings('xtream', true)), false);
});
