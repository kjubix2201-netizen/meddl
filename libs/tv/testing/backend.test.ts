import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    backendUrl,
    checkBackend,
    discoveryCandidates,
    identifyBackend,
} from '@meddl/tv/data-access';
test('discovery stays in the actual private /24 or smaller subnet and never scans a public or unknown network', () => {
    const subnet = discoveryCandidates({
        ipAddress: '192.168.1.130',
        netmask: '255.255.255.252',
    });
    assert.equal(subnet.length, 6);
    assert(subnet.includes('http://192.168.1.129:3335'));
    assert(!subnet.some((x) => x.includes('192.168.1.130')));
    assert.equal(
        discoveryCandidates({ ipAddress: '8.8.8.8', netmask: '255.255.255.0' })
            .length,
        3
    );
    assert.equal(
        discoveryCandidates({ ipAddress: '10.0.0.1', netmask: '255.0.0.0' })
            .length,
        3
    );
    assert(
        discoveryCandidates({
            ipAddress: '192.168.1.44',
            netmask: '255.255.255.0',
        }).length < 770
    );
    assert.throws(() => backendUrl('http://host/?password=secret'));
});
test('backend recognition rejects unrelated health pages and never sends secrets before identification', async (t) => {
    const requests: RequestInit[] = [];
    t.mock.method(
        globalThis,
        'fetch',
        async (_input: unknown, init?: RequestInit) => {
            requests.push(init!);
            return Response.json({ status: 'ok' });
        }
    );
    await assert.rejects(
        checkBackend(
            'http://backend.example',
            'secret',
            new AbortController().signal
        )
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers, undefined);
});
test('connected means identity and authorized API checks succeed, with cancellation forwarded', async (t) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    t.mock.method(
        globalThis,
        'fetch',
        async (input: unknown, init?: RequestInit) => {
            calls.push({ url: String(input), init });
            return Response.json(
                String(input).endsWith('/check')
                    ? { service: 'meddl', connected: true }
                    : {
                          service: 'meddl',
                          protocol: 1,
                          pairing: true,
                          auth: 'token',
                      }
            );
        }
    );
    const info = await checkBackend(
        'http://backend.example/api/',
        'secret',
        new AbortController().signal
    );
    assert.equal(info.url, 'http://backend.example/api');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].init?.headers, {
        Authorization: 'Bearer secret',
    });
    assert.equal(calls[0].init?.redirect, 'error');
    assert(calls[0].init?.signal);
});
test('identification rejects malformed advertised capabilities', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            service: 'meddl',
            protocol: 99,
            pairing: true,
            auth: 'none',
        })
    );
    await assert.rejects(
        identifyBackend('http://backend.example', new AbortController().signal)
    );
});

test('whole-section Xtream lists get the long request time, everything else the short one', async () => {
    const { isFullListRequest, FULL_LIST_TIMEOUT_MS } = await import('@meddl/tv/data-access');
    assert.equal(isFullListRequest({ action: 'get_vod_streams' }), true);
    assert.equal(isFullListRequest({ action: 'get_series' }), true);
    assert.equal(isFullListRequest({ action: 'get_live_streams', category_id: 3 }), false);
    assert.equal(isFullListRequest({ action: 'get_vod_info', vod_id: 1 }), false);
    assert.ok(FULL_LIST_TIMEOUT_MS > 35000);
});

test('the phone setup QR code never points to localhost when the server knows its home-network address', async () => {
    const { phoneBackendUrl } = await import('@meddl/tv/data-access');
    const signal = new AbortController().signal;
    const original = globalThis.fetch;
    let asked = '';
    globalThis.fetch = (async (url: string) => {
        asked = String(url);
        return new Response(
            JSON.stringify({ service: 'meddl', protocol: 1, pairing: true, auth: 'none', addresses: ['192.168.178.21'] }),
            { headers: { 'Content-Type': 'application/json' } }
        );
    }) as typeof fetch;
    try {
        assert.equal(await phoneBackendUrl('http://localhost:3333', signal), 'http://192.168.178.21:3333');
        assert.equal(asked, 'http://localhost:3333/tv/connection');
        assert.equal(await phoneBackendUrl('http://127.0.0.1:3333', signal), 'http://192.168.178.21:3333');
        asked = '';
        // A real address is already reachable: kept, no lookup.
        assert.equal(await phoneBackendUrl('http://192.168.1.5:3333', signal), 'http://192.168.1.5:3333');
        assert.equal(asked, '');
    } finally {
        globalThis.fetch = original;
    }
});
