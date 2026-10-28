import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesktopMpvSession, desktopMpvAvailable, type DesktopMpvState } from '@meddl/tv/data-access';

function fakeDesktop() {
    const calls: string[] = [];
    let push: ((state: DesktopMpvState) => void) | undefined;
    const state = (patch: Partial<DesktopMpvState> = {}): DesktopMpvState => ({
        id: 'mpv-1',
        status: 'playing',
        positionSeconds: 0,
        durationSeconds: 100,
        volume: 0.95,
        ...patch,
    });
    (globalThis as unknown as { window: unknown }).window = {
        electron: {
            prepareEmbeddedMpv: async () => ({ supported: true }),
            createEmbeddedMpvSession: async () => {
                calls.push('create');
                return state({ status: 'loading' });
            },
            loadEmbeddedMpvPlayback: async (id: string, playback: { streamUrl: string; startTime?: number }) => {
                calls.push(`load ${id} ${playback.streamUrl} ${playback.startTime}`);
            },
            setEmbeddedMpvVolume: async (_id: string, volume: number) => {
                calls.push(`volume ${volume}`);
                return state({ volume });
            },
            setEmbeddedMpvPaused: async (_id: string, paused: boolean) => {
                calls.push(`paused ${paused}`);
                return state({ status: paused ? 'paused' : 'playing' });
            },
            disposeEmbeddedMpvSession: async (id: string) => {
                calls.push(`dispose ${id}`);
            },
            onEmbeddedMpvSessionUpdate: (callback: (s: DesktopMpvState) => void) => {
                push = callback;
                return () => (push = undefined);
            },
        },
    };
    return { calls, push: (s: Partial<DesktopMpvState>) => push?.(state(s)) };
}

test('the desktop MPV player opens the stream at the saved position and follows its updates', async () => {
    const desktop = fakeDesktop();
    assert.equal(desktopMpvAvailable(), true);
    const seen: DesktopMpvState[] = [];
    const session = new DesktopMpvSession((s) => seen.push(s));
    await session.start({ x: 0, y: 0, width: 1920, height: 900 }, { streamUrl: 'http://p.example/movie/1.mkv', title: 'Film', startTime: 754 });
    assert.deepEqual(desktop.calls, ['create', 'load mpv-1 http://p.example/movie/1.mkv 754']);
    desktop.push({ positionSeconds: 800 });
    desktop.push({ id: 'other', positionSeconds: 5 });
    assert.equal(session.state?.positionSeconds, 800);
    assert.equal(seen.at(-1)?.positionSeconds, 800);
});

test('volume stays between 0 and 1, pause toggles and stop frees the player once', async () => {
    const desktop = fakeDesktop();
    const session = new DesktopMpvSession(() => undefined);
    await session.start({ x: 0, y: 0, width: 10, height: 10 }, { streamUrl: 'http://p.example/live/1.ts', title: 'Live', isLive: true });
    session.state = { ...session.state!, status: 'playing', volume: 0.95 };
    session.changeVolume(0.1);
    session.togglePause();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(desktop.calls.includes('volume 1'));
    assert.ok(desktop.calls.includes('paused true'));
    await session.stop();
    await session.stop();
    assert.equal(desktop.calls.filter((c) => c.startsWith('dispose')).length, 1);
});
