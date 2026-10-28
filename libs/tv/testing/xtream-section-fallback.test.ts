import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider, ProviderTransport } from '@meddl/tv/data-access';
import type { Source } from '@meddl/tv/util';

const source: Source = { id: 'x', provider: 'xtream', name: 'T', url: 'https://p.invalid', username: 'u', password: 'p' };

test('a whole movie list that never arrives is built category by category', async () => {
    const asked: string[] = [];
    const transport = new (class extends ProviderTransport {
        constructor() {
            super('http://x.invalid');
        }
        override async request(_s: Source, _r: 'xtream' | 'stalker' | 'parse', params: Record<string, string | number>) {
            const action = String(params['action']);
            asked.push(`${action}:${params['category_id'] ?? ''}`);
            if (action === 'get_vod_categories')
                return [{ category_id: '1', category_name: 'DE | A' }, { category_id: '2', category_name: 'DE | B' }];
            if (action === 'get_vod_streams' && params['category_id'] === undefined) throw new Error('timeout');
            if (action === 'get_vod_streams')
                return [{ stream_id: Number(params['category_id']) * 10, name: `Film ${params['category_id']}`, category_id: params['category_id'] }];
            return [];
        }
    })();
    const provider = createProvider(source, transport, async () => undefined);
    const result = await provider.catalog('movie', '', 0, '', new AbortController().signal);
    assert.equal(result.total, 2);
    assert.deepEqual(asked.filter((a) => a.startsWith('get_vod_streams')), ['get_vod_streams:', 'get_vod_streams:1', 'get_vod_streams:2']);
});
