import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Catalog, Media, ProviderClient } from '@meddl/tv/util';
import { CachedProvider } from '@meddl/tv/data-access';

function fakeProvider() {
    const calls: string[] = [];
    let fail = false;
    let empty = false;
    let gate: Promise<void> = Promise.resolve();
    const client: ProviderClient = {
        capabilities: { live: true, movies: true, series: false, epg: true },
        connect: async () => ({ id: 's', name: 's', provider: 'm3u', url: '' }),
        async catalog(kind, category, page, query, _signal, sort): Promise<Catalog> {
            calls.push(`catalog:${kind}:${category}:${page}:${query}:${sort}`);
            await gate;
            if (fail) throw new Error('offline');
            return { items: [], total: 0, page, categories: empty ? [] : [{ id: 'c', name: 'C' }] };
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
        setEmpty: (value: boolean) => (empty = value),
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

test('films and series follow at once unless channels are on screen already', async (t) => {
    // Not at time zero: "no key pressed yet" must lie far in the past.
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    // Lets everything that is ready run; `setImmediate` is not mocked.
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const run = (liveAnswer: 'channels' | 'empty' | 'fails') => {
        const calls: string[] = [];
        const fake = fakeProvider();
        fake.client.catalog = async (kind, _category, page): Promise<Catalog> => {
            calls.push(kind);
            if (kind === 'live' && liveAnswer === 'fails') throw new Error('offline');
            const items = kind === 'live' && liveAnswer === 'channels' ? [{ id: 'a' } as Media] : [];
            return { items, total: items.length, page, categories: [{ id: 'c', name: 'C' }] };
        };
        const cached = new CachedProvider(fake.client);
        void cached.warm({ movie: 'recent', series: 'recent' });
        return { calls, cached };
    };
    // Home shows nothing yet and waits for the lists: no pause for the remote.
    for (const answer of ['empty', 'fails'] as const) {
        const { calls, cached } = run(answer);
        await flush();
        assert.deepEqual(calls, ['live', 'movie'], answer);
        await cached.warmed('movie');
    }
    // Channels came at once: the big list follows a moment later.
    const { calls } = run('channels');
    await flush();
    assert.deepEqual(calls, ['live']);
    t.mock.timers.tick(2500);
    await flush();
    assert.deepEqual(calls, ['live', 'movie']);
});

test('empty answers are asked again and catalog requests run one at a time', async () => {
    const fake = fakeProvider();
    const cached = new CachedProvider(fake.client);
    fake.setEmpty(true);
    await cached.catalog('movie', '', 0, '', live());
    await cached.catalog('movie', '', 0, '', live());
    assert.equal(fake.calls.length, 2);
    const order: string[] = [];
    const slow = fakeProvider();
    let running = 0;
    const inner = slow.client;
    const original = inner.catalog.bind(inner);
    inner.catalog = async (...args) => {
        running += 1;
        order.push(`start:${args[0]}:${running}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return original(...args);
    };
    const queued = new CachedProvider(inner);
    await Promise.all([
        queued.catalog('live', '', 0, '', live()),
        queued.catalog('movie', '', 0, '', live()),
    ]);
    assert.deepEqual(order, ['start:live:1', 'start:movie:1']);
});
