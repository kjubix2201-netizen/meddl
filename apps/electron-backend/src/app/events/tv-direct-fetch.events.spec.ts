jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));

import { tvDirectFetch } from './tv-direct-fetch.events';

describe('tvDirectFetch', () => {
    it('fetches http(s) addresses with the given headers and passes status and body through', async () => {
        const fetchImpl = jest.fn(async () => new Response('[1]', { status: 200 }));
        await expect(
            tvDirectFetch(
                {
                    url: 'http://panel.example/player_api.php?action=get_vod_streams',
                    headers: { 'User-Agent': 'MAG200', Cookie: 'mac=x', broken: 5 },
                    timeoutMs: 180000,
                },
                fetchImpl as unknown as typeof fetch
            )
        ).resolves.toEqual({ status: 200, body: '[1]' });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://panel.example/player_api.php?action=get_vod_streams');
        expect(init.headers).toEqual({ 'User-Agent': 'MAG200', Cookie: 'mac=x' });
        expect(init.redirect).toBe('follow');
    });

    it('refuses anything but http and https', async () => {
        for (const url of ['file:///etc/passwd', 'ftp://x.example/', 42])
            await expect(tvDirectFetch({ url })).rejects.toThrow();
    });
});
