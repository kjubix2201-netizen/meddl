import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Lets everything that is ready run; `setImmediate` is not one of the mocked timers. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('background work waits for a pause in the input, but never longer than the given time', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    // The module listens on `window`; a bare event target stands in for it.
    const page = new EventTarget();
    const scope = globalThis as { window?: unknown };
    scope.window = page;
    t.after(() => delete scope.window);
    const { untilUserIdle } = await import('../data-access/src/user-idle');
    const press = () => page.dispatchEvent(new Event('keydown'));

    // A viewer who presses a key every second never pauses for three.
    press();
    let done = false;
    void untilUserIdle(3000, undefined, 10_000).then(() => (done = true));
    for (let second = 1; second <= 9; second++) {
        t.mock.timers.tick(1000);
        await flush();
        assert.equal(done, false, `still waiting after ${second} s`);
        press();
    }
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(done, true);

    // A pause ends the wait as before.
    press();
    let paused = false;
    void untilUserIdle(3000).then(() => (paused = true));
    t.mock.timers.tick(2900);
    await flush();
    assert.equal(paused, false);
    t.mock.timers.tick(100);
    await flush();
    assert.equal(paused, true);

    // No time left, or a cancelled owner: at once.
    press();
    let immediate = 0;
    void untilUserIdle(3000, undefined, 0).then(() => immediate++);
    void untilUserIdle(3000, AbortSignal.abort()).then(() => immediate++);
    await flush();
    assert.equal(immediate, 2);
});
