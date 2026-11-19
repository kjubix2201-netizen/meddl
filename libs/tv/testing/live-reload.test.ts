import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_DROP_LIMIT, LIVE_DROP_WINDOW_MS, LIVE_LINK_TIMEOUT_MS, LiveReload } from '../feature/src/live-reload';

/** Lets everything that is ready run; `setImmediate` is not one of the mocked timers. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a dropped live stream is loaded again from a newly asked link, and a repeated state counts once', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const loads: (string | undefined)[] = [];
    let asked = 0;
    const live = new LiveReload(
        (link) => loads.push(link),
        async () => `link-${++asked}`
    );
    assert.equal(live.observe('loading'), false);
    assert.equal(live.observe('playing'), false);
    assert.equal(live.observe('paused'), false);
    assert.equal(live.observe('ended'), true);
    assert.equal(live.observe('ended'), true);
    assert.deepEqual(loads, []);
    t.mock.timers.tick(300);
    await flush();
    assert.deepEqual(loads, ['link-1']);
    assert.equal(live.observe('loading'), false);
    assert.equal(live.observe('playing'), false);
    // The second drop within the window waits a little longer.
    assert.equal(live.observe('error'), true);
    t.mock.timers.tick(300);
    await flush();
    assert.equal(loads.length, 1);
    t.mock.timers.tick(1200);
    await flush();
    assert.deepEqual(loads, ['link-1', 'link-2']);
});

test('the player gives up after too many drops; Play starts again, counted from zero', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const loads: (string | undefined)[] = [];
    const live = new LiveReload((link) => loads.push(link));
    for (let drop = 1; drop <= LIVE_DROP_LIMIT; drop++) {
        assert.equal(live.observe('error'), true);
        t.mock.timers.tick(1500);
        await flush();
        assert.equal(loads.length, drop);
    }
    assert.equal(live.observe('error'), false);
    assert.equal(live.observe('error'), false);
    live.retry();
    // Until the reload starts the repeated state stays covered.
    assert.equal(live.observe('error'), true);
    await flush();
    assert.equal(loads.length, LIVE_DROP_LIMIT + 1);
    assert.equal(live.observe('error'), true);
    t.mock.timers.tick(1500);
    await flush();
    assert.equal(loads.length, LIVE_DROP_LIMIT + 2);
    // Drops long ago no longer count.
    t.mock.timers.tick(LIVE_DROP_WINDOW_MS);
    for (let drop = 1; drop <= LIVE_DROP_LIMIT; drop++) {
        assert.equal(live.observe('ended'), true);
        t.mock.timers.tick(1500);
        await flush();
    }
    assert.equal(live.observe('ended'), false);
});

test('without a new link (failed or too slow) the last known one is loaded', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const loads: (string | undefined)[] = [];
    const answers: ((signal: AbortSignal) => Promise<string | undefined>)[] = [
        async () => 'fresh',
        async () => {
            throw new Error('portal offline');
        },
        () => new Promise(() => undefined),
    ];
    let cancelled = false;
    const live = new LiveReload(
        (link) => loads.push(link),
        (signal) => {
            signal.addEventListener('abort', () => (cancelled = true));
            return (answers.shift() ?? (async () => undefined))(signal);
        }
    );
    for (const expected of [1, 2]) {
        assert.equal(live.observe('error'), true);
        t.mock.timers.tick(1500);
        await flush();
        assert.equal(loads.length, expected);
    }
    assert.deepEqual(loads, ['fresh', 'fresh']);
    assert.equal(live.observe('error'), true);
    t.mock.timers.tick(1500);
    await flush();
    assert.equal(loads.length, 2);
    assert.equal(cancelled, false);
    t.mock.timers.tick(LIVE_LINK_TIMEOUT_MS);
    await flush();
    assert.deepEqual(loads, ['fresh', 'fresh', 'fresh']);
    assert.equal(cancelled, true);
});

test('one reload per drop: the app\'s own reconnect in between is not a second one, and a stream that is back is left alone', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const loads: (string | undefined)[] = [];
    let answer: (link: string) => void = () => undefined;
    const live = new LiveReload(
        (link) => loads.push(link),
        () => new Promise<string>((resolve) => (answer = resolve))
    );
    live.observe('playing');
    assert.equal(live.observe('error'), true);
    t.mock.timers.tick(300);
    await flush();
    // The link is still on its way; the app tries the old one and fails.
    assert.equal(live.observe('loading'), false);
    assert.equal(live.observe('error'), true);
    t.mock.timers.tick(5);
    answer('fresh');
    await flush();
    assert.deepEqual(loads, ['fresh']);
    live.observe('loading');
    live.observe('playing');
    // A late "ended" of the old stream schedules a reload; it plays again by then.
    assert.equal(live.observe('ended'), true);
    assert.equal(live.observe('playing'), false);
    t.mock.timers.tick(1500);
    answer('unused');
    await flush();
    assert.deepEqual(loads, ['fresh']);
    // A closed player loads nothing any more.
    assert.equal(live.observe('error'), true);
    live.stop();
    t.mock.timers.tick(1500);
    answer('late');
    await flush();
    assert.deepEqual(loads, ['fresh']);
    assert.equal(live.observe('ended'), false);
});
