import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CachedProvider, createProvider, findTopTitles, ProviderTransport } from '@meddl/tv/data-access';
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
