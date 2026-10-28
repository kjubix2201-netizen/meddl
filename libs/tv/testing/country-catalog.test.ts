import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    categoryFilter,
    joinCategories,
    NO_CATEGORY,
    Source,
} from '@meddl/tv/util';
import { createProvider, ProviderTransport } from '@meddl/tv/data-access';
import {
    categoriesOfCountry,
    countryGroups,
    needsCountry,
} from '../feature/src/country-catalog';
import { firstRoute } from '../feature/src/navigation';

const signal = new AbortController().signal;
class Transport extends ProviderTransport {
    constructor(private respond: (params: Record<string, string | number>) => unknown) {
        super('https://backend.invalid');
    }
    async request(
        _source: Source,
        _route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>
    ) {
        return this.respond(params);
    }
}
const categories = [
    { id: '1', name: 'US | News' },
    { id: '2', name: 'DE | Sport' },
    { id: '3', name: 'DE | Kino' },
    { id: '4', name: 'SPORT 4K' },
    { id: '5', name: 'FR | Films' },
];

test('category filters accept one id, a joined list or everything', () => {
    assert.equal(categoryFilter('')('x'), true);
    assert.equal(categoryFilter('2')('2'), true);
    assert.equal(categoryFilter('2')('3'), false);
    const both = categoryFilter(joinCategories(['2', '3']));
    assert.deepEqual(['1', '2', '3', undefined].map(both), [false, true, true, false]);
    assert.equal(joinCategories(['7']), '7');
    assert.equal(categoryFilter(NO_CATEGORY)('none'), false);
    assert.equal(categoryFilter(NO_CATEGORY)(''), false);
});

test('countries put Germany first, then by size; untagged and all close the list', () => {
    const counts = { '1': 300, '2': 40, '3': 60, '4': 5, '5': 0 };
    const groups = countryGroups(categories, counts);
    assert.deepEqual(
        groups.map((g) => [g.code, g.titles]),
        [
            ['DE', 100],
            ['US', 300],
            ['other', 5],
            ['all', 405],
        ]
    );
    assert.deepEqual(
        categoriesOfCountry(categories, 'DE').map((c) => c.id),
        ['2', '3']
    );
    assert.equal(categoriesOfCountry(categories, 'all').length, 5);
    // Without counts (Stalker) every country stays, sized by categories.
    assert.deepEqual(
        countryGroups(categories).map((g) => g.code),
        ['DE', 'FR', 'US', 'other', 'all']
    );
});

test('Live TV, Movies and Series ask for a country first', () => {
    for (const view of ['live', 'movies', 'series'] as const)
        assert.equal(needsCountry({ ...firstRoute(), view }), true);
    assert.equal(needsCountry({ ...firstRoute(), view: 'live', country: 'DE' }), false);
    assert.equal(needsCountry({ ...firstRoute(), view: 'search' }), false);
});

test('Xtream scopes titles and search to all categories of a country and reports counts', async () => {
    const rows = [
        { stream_id: 1, name: 'Tagesschau', category_id: '2' },
        { stream_id: 2, name: 'Tatort Kino', category_id: '3' },
        { stream_id: 3, name: 'CNN', category_id: '1' },
        { stream_id: 4, name: 'Tagesthemen USA', category_id: '1' },
    ];
    const provider = createProvider(
        { id: 'c', name: 'mock', provider: 'xtream', url: 'https://provider.invalid' },
        new Transport((p) =>
            String(p.action).endsWith('categories')
                ? categories.map((c) => ({ category_id: c.id, category_name: c.name }))
                : rows
        ),
        async () => undefined
    );
    const german = joinCategories(['2', '3']);
    const all = await provider.catalog('live', german, 0, '', signal);
    assert.deepEqual(all.items.map((m) => m.title), ['Tagesschau', 'Tatort Kino']);
    assert.deepEqual(all.categoryCounts, { '1': 2, '2': 1, '3': 1 });
    const search = await provider.catalog('live', german, 0, 'tages', signal);
    assert.deepEqual(search.items.map((m) => m.title), ['Tagesschau']);
    assert.equal(provider.capabilities.multiCategory, true);
});
