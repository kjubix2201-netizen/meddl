import { PROVIDER_REQUEST_TIMEOUT_MS, xtreamRequestTimeout } from './host-guard';

describe('xtreamRequestTimeout', () => {
    it('gives whole-section lists time to be assembled by the panel', () => {
        for (const action of ['get_live_streams', 'get_vod_streams', 'get_series'])
            expect(xtreamRequestTimeout(action, undefined)).toBe(
                PROVIDER_REQUEST_TIMEOUT_MS.xtreamFullList
            );
        expect(PROVIDER_REQUEST_TIMEOUT_MS.xtreamFullList).toBeGreaterThan(
            PROVIDER_REQUEST_TIMEOUT_MS.xtream
        );
    });

    it('keeps the short limit for single categories and every other call', () => {
        expect(xtreamRequestTimeout('get_vod_streams', '12')).toBe(PROVIDER_REQUEST_TIMEOUT_MS.xtream);
        expect(xtreamRequestTimeout('get_vod_categories', undefined)).toBe(PROVIDER_REQUEST_TIMEOUT_MS.xtream);
        expect(xtreamRequestTimeout(undefined, undefined)).toBe(PROVIDER_REQUEST_TIMEOUT_MS.xtream);
    });
});
