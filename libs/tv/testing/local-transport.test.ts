import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalTransport, ProviderRequestError } from '@meddl/tv/data-access';
import type { Source } from '@meddl/tv/util';

type Call = { url: string; headers: Record<string, string>; timeoutMs: number };
function desktop(respond: (url: string) => { status: number; body: string }) {
    const calls: Call[] = [];
    (globalThis as unknown as { window: unknown }).window = {
        meddlDesktop: {
            directFetch: async (url: string, headers: Record<string, string>, timeoutMs: number) => {
                calls.push({ url, headers, timeoutMs });
                return respond(url);
            },
        },
    };
    return calls;
}
const signal = new AbortController().signal;
const xtream: Source = { id: 'x', name: 'x', provider: 'xtream', url: 'http://panel.example:8080/', username: 'u', password: 'p' };

test('Xtream calls go straight to player_api.php with long time for whole lists', async () => {
    const calls = desktop(() => ({ status: 200, body: '[{"stream_id":1}]' }));
    const transport = new LocalTransport();
    const payload = await transport.request(xtream, 'xtream', { action: 'get_vod_streams', username: 'u', password: 'p' }, signal);
    assert.deepEqual(payload, [{ stream_id: 1 }]);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, 'http://panel.example:8080/player_api.php');
    assert.equal(url.searchParams.get('action'), 'get_vod_streams');
    assert.ok(calls[0].timeoutMs > 60000);
    await transport.request(xtream, 'xtream', { action: 'get_account_info' }, signal);
    assert.equal(calls[1].timeoutMs, 30000);
});

test('Stalker credentials travel as headers, never in the portal address', async () => {
    const calls = desktop(() => ({ status: 200, body: '{"js":{"token":"t"}}' }));
    const stalker: Source = { id: 's', name: 's', provider: 'stalker', url: 'http://portal.example/c/', macAddress: '00:1A:79:00:00:01' };
    const payload = await new LocalTransport().request(
        stalker,
        'stalker',
        { type: 'stb', action: 'get_profile', macAddress: '00:1A:79:00:00:01', token: 'secret', serialNumber: 'ABC' },
        signal,
        'http://portal.example/stalker_portal/server/load.php'
    );
    assert.deepEqual(payload, { js: { token: 't' } });
    const { url, headers } = calls[0];
    assert.ok(!url.includes('00:1A:79') && !url.includes('secret'), url);
    assert.match(headers['Cookie'], /mac=00(%3A|:)1A/i);
    assert.equal(headers['Authorization'], 'Bearer secret');
    assert.match(url, /action=get_profile/);
});

test('M3U playlists are parsed on the device; provider errors become request errors', async () => {
    desktop((url) =>
        url.endsWith('bad')
            ? { status: 403, body: 'no' }
            : { status: 200, body: '#EXTM3U\n#EXTINF:-1 group-title="DE | News",Tagesschau\nhttp://s.example/1.ts\n' }
    );
    const m3u: Source = { id: 'm', name: 'm', provider: 'm3u', url: 'http://lists.example/a.m3u' };
    const result = (await new LocalTransport().request(m3u, 'parse', {}, signal)) as {
        playlist: { items: { name: string; url: string }[] };
    };
    assert.equal(result.playlist.items[0].name, 'Tagesschau');
    assert.equal(result.playlist.items[0].url, 'http://s.example/1.ts');
    await assert.rejects(
        new LocalTransport().request({ ...m3u, url: 'http://lists.example/bad' }, 'parse', {}, signal),
        (error) => error instanceof ProviderRequestError && error.status === 403
    );
});
