import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VpnState } from '../feature/src/vpn-shell';

/** Lets everything that is ready run; `setImmediate` is not one of the mocked timers. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('the desktop app\'s VPN: its state, its commands and the wait for the lock at start', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    let state: VpnState = {
        available: true,
        configured: true,
        state: 'down',
        error: '',
        autostart: false,
        lock: true,
        name: 'Proton',
    };
    const calls: string[] = [];
    let push: (next: unknown) => void = () => undefined;
    const report = (next: Partial<VpnState>) => {
        state = { ...state, ...next };
        push(state);
    };
    // The desktop app's bridge (apps/electron-backend main.preload.ts).
    const scope = globalThis as { window?: unknown };
    scope.window = {
        meddlDesktop: {
            vpn: {
                state: async () => state,
                importProfile: async (text: string, name: string) => {
                    calls.push(`import ${name}`);
                    return text.includes('[Interface]') ? '' : 'invalid';
                },
                connect: async () => void calls.push('connect'),
                disconnect: async () => void calls.push('disconnect'),
                remove: async () => void calls.push('remove'),
                setAutostart: async (on: boolean) => void calls.push(`autostart ${on}`),
                setLock: async (on: boolean) => void calls.push(`lock ${on}`),
                onChange: (callback: (next: unknown) => void) => {
                    push = callback;
                    return () => undefined;
                },
            },
        },
    };
    t.after(() => delete scope.window);
    const { vpnAvailable, vpnConnected, vpnControl, vpnReady } = await import('../feature/src/vpn-shell');

    assert.equal(vpnAvailable(), true);
    // Nothing heard from the app yet: a failed request is not blamed on the VPN.
    assert.equal(vpnConnected(), false);
    const control = vpnControl();
    assert.ok(control);
    // The profile is a file on the computer, not sent from a phone.
    assert.equal(control.source, 'file');
    assert.equal(control.current(), undefined);

    // The lock is on and the VPN down: the start connects and waits.
    const waited: string[] = [];
    let ready = false;
    const gate = vpnReady(new AbortController().signal, (error) => waited.push(error)).then(() => (ready = true));
    await flush();
    assert.deepEqual(calls, ['connect']);
    assert.deepEqual(waited, ['']);
    assert.deepEqual(control.current(), state);
    report({ state: 'connecting' });
    t.mock.timers.tick(500);
    await flush();
    assert.equal(ready, false);
    report({ state: 'down', error: 'failed' });
    t.mock.timers.tick(500);
    await flush();
    assert.equal(waited.at(-1), 'failed');
    assert.equal(calls.length, 1);
    // Still down a while later: it asks again.
    t.mock.timers.tick(15_000);
    await flush();
    assert.deepEqual(calls, ['connect', 'connect']);
    assert.equal(vpnConnected(), false);
    report({ state: 'up', error: '' });
    t.mock.timers.tick(500);
    await flush();
    await gate;
    assert.equal(ready, true);
    // From here on a request that fails failed on its way through the tunnel.
    assert.equal(vpnConnected(), true);

    // Nothing to wait for: no lock, no profile, or a build without the tunnel.
    for (const open of [{ lock: false }, { lock: true, configured: false }, { configured: true, available: false }]) {
        report({ state: 'down', ...open });
        await vpnReady(new AbortController().signal, () => assert.fail('must not wait'));
    }
    assert.deepEqual(calls, ['connect', 'connect']);

    // A start that is called off stops waiting.
    report({ available: true, lock: true, configured: true, state: 'down' });
    const abort = new AbortController();
    const cancelled = vpnReady(abort.signal, () => undefined);
    await flush();
    abort.abort();
    t.mock.timers.tick(500);
    await assert.rejects(cancelled, { name: 'AbortError' });

    // Commands go to the app; its answers come back as state changes.
    calls.length = 0;
    const seen: string[] = [];
    const stop = control.subscribe((next) => seen.push(next.state));
    assert.equal(await control.importProfile('[Interface]', 'Proton DE'), '');
    assert.equal(await control.importProfile('nonsense', 'x'), 'invalid');
    control.disconnect();
    control.setLock(false);
    control.setAutostart(true);
    control.remove();
    await flush();
    assert.deepEqual(calls, ['import Proton DE', 'import x', 'disconnect', 'lock false', 'autostart true', 'remove']);
    report({ state: 'connecting' });
    stop();
    report({ state: 'up' });
    assert.deepEqual(seen, ['connecting']);
});
