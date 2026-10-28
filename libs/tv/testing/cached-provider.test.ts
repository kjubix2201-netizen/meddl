import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Catalog, Media, ProviderClient } from '@meddl/tv/util';
import { CachedProvider } from '@meddl/tv/data-access';

function fakeProvider() {
    const calls: string[] = [];
    let fail = false;
    let gate: Promise<void> = Promise.resolve();
    const client: ProviderClient = {
        capabilities: { live: true, movies: true, series: false, epg: true },
        connect: async () => ({ id: 's', name: 's', provider: 'm3u', url: '' }),
        async catalog(kind, category, page, query, _signal, sort): Promise<Catalog> {
            calls.push(`catalog:${kind}:${category}:${page}:${query}:${sort}`);
            await gate;
            if (fail) throw new Error('offline');
            return { items: [], total: 0, page, categories: [] };
        },
        details: async (item) => {
            calls.push(`details:${item.id}`);
            return item;
        },
        episodes: async () => [],
        epg: async () => [],
        resolve: async (item) => {
            calls.push(`resolve:${item.id}`);
            return { url: 'x' };
        },
        dispose: () => calls.push('dispose'),
    };
    return {
        client,
        calls,
        setFail: (value: boolean) => (fail = value),
        hold: () => {
            let open = () => undefined as void;
            gate = new Promise<void>((resolve) => (open = resolve));
            return () => open();
        },
    };
}
const live = () => new AbortController().signal;

test('the same list is fetched once per session, also after switching back', async () => {
    const fake = fakeProvider();
    const cached = new CachedProvider(fake.client);
    await cached.catalog('live', '', 0, '', live(), 'provider');
    await cached.catalog('movie', '', 0, '', live());
    await cached.catalog('live', '', 0, '', live(), 'provider');
    await cached.catalog('live', '', 0, ' ', live(), 'provider');
    assert.deepEqual(fake.calls, [
        'catalog:live::0::provider',
        'catalog:movie::0::recent',
    ]);
});

test('a screen that moves on does not cancel the shared request', async () => {
    const fake = fakeProvider();
    const cached = new CachedProvider(fake.client);
    const release = fake.hold();
    const leaving = new AbortController();
    const first = cached.catalog('live', '7', 0, '', leaving.signal);
    leaving.abort();
    await assert.rejects(first, { name: 'AbortError' });
    release();
    await cached.catalog('live', '7', 0, '', live());
    assert.equal(fake.calls.length, 1);
});

test('failures are not kept; stream links are always resolved fresh', async () => {
    const fake = fakeProvider();
    const cached = new CachedProvider(fake.client);
    fake.setFail(true);
    await assert.rejects(cached.catalog('live', '', 0, '', live()));
    fake.setFail(false);
    await cached.catalog('live', '', 0, '', live());
    assert.equal(fake.calls.filter((c) => c.startsWith('catalog')).length, 2);
    const item = { id: 'a' } as Media;
    await cached.resolve(item, live());
    await cached.resolve(item, live());
    await cached.details(item, live());
    await cached.details(item, live());
    assert.equal(fake.calls.filter((c) => c === 'resolve:a').length, 2);
    assert.equal(fake.calls.filter((c) => c === 'details:a').length, 1);
});

test('warming loads each supported section once', async () => {
    const fake = fakeProvider();
    const cached = new CachedProvider(fake.client);
    const steps: string[] = [];
    await cached.warm({ movie: 'title', series: 'recent' }, (kind, state) => steps.push(`${kind}:${state}`));
    assert.deepEqual(steps, ['live:loading', 'live:done', 'movie:loading', 'movie:done']);
    await cached.catalog('movie', '', 0, '', live(), 'title');
    assert.deepEqual(fake.calls, [
        'catalog:live::0::provider',
        'catalog:movie::0::title',
    ]);
    cached.dispose();
    assert.equal(fake.calls.at(-1), 'dispose');
});
