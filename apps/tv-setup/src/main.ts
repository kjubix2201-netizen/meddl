import { settingsForm } from './settings-form';
import { vpnForm } from './vpn-form';
import type { PhoneSettingsDefaults } from '@meddl/tv/util';
import './theme.css';
import { tr, translatePage } from './i18n';
/** Phone-only setup UI; the capability stays in this page’s memory. */
export function phoneClient() {
    translatePage();
    window.addEventListener('hashchange', () => {
        if (location.hash) location.reload();
    });
    const fragment = location.hash.slice(1).split('.');
    const [id, token] = fragment;
    // Keep the capability in this tab's memory, out of the address bar and referrers.
    history.replaceState(null, '', location.pathname);
    const form = document.querySelector<HTMLFormElement>('form')!;
    const status = document.querySelector<HTMLElement>('[role=status]')!;
    let submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const provider = form.elements.namedItem('provider') as HTMLSelectElement;
    let configured = false;
    let settings = false;
    let vpn = false;
    let finished = false;
    let sent = false;
    const endpoint = `./pairing/${encodeURIComponent(id ?? '')}/phone`;
    async function request(method = 'GET', body?: unknown) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 8000);
        try {
            const response = await fetch(endpoint, {
                method,
                signal: abort.signal,
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    'X-TV-Pairing': token ?? '',
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const data = await response.json();
            if (!response.ok) {
                if ([403, 410].includes(response.status)) finished = true;
                throw new Error(
                    data.message || 'Could not reach the TV. Try again.'
                );
            }
            return data as {
                status: string;
                purpose?: string;
                defaults?: PhoneSettingsDefaults;
            };
        } finally {
            clearTimeout(timer);
        }
    }
    function fields() {
        const type = provider.value;
        document
            .querySelectorAll<HTMLElement>('[data-providers]')
            .forEach((group) => {
                const visible = group.dataset
                    .providers!.split(' ')
                    .includes(type);
                group.hidden = !visible;
                group
                    .querySelectorAll<HTMLInputElement>('input')
                    .forEach((input) => {
                        input.disabled = !visible;
                        input.required =
                            visible &&
                            (input.name === 'macAddress' ||
                                (type === 'xtream' &&
                                    ['username', 'password'].includes(
                                        input.name
                                    )));
                    });
            });
        document.querySelector('#url-label')!.textContent =
            type === 'm3u' ? tr('Playlist URL') : tr('Provider URL');
    }
    provider.onchange = fields;
    fields();
    function render(response: {
        status: string;
        purpose?: string;
        defaults?: PhoneSettingsDefaults;
    }) {
        const state = response.status;
        if (!configured && response.purpose) {
            configured = true;
            settings = response.purpose === 'settings';
            vpn = response.purpose === 'vpn';
            if (vpn) {
                vpnForm(form);
                submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
            }
            if (settings && response.defaults) {
                settingsForm(form, response.defaults);
                submit = form.querySelector<HTMLButtonElement>(
                    'button[type=submit]'
                )!;
            }
        }
        if (state === 'waiting' && !sent) {
            form.hidden = false;
            submit.disabled = false;
            status.textContent = vpn
                ? tr('Choose your WireGuard file. Confirm on the TV to finish.')
                : settings
                  ? tr('Adjust settings. Confirm on the TV to finish.')
                  : tr('Enter your source details. Confirm on the TV to finish.');
            return;
        }
        form.hidden = true;
        status.textContent =
            state === 'saved'
                ? vpn
                    ? tr('VPN profile saved on your TV. You can close this page.')
                    : settings
                    ? tr('Settings saved on your TV. You can close this page.')
                    : tr('Added to your TV. You can close this page.')
                : state === 'rejected'
                  ? tr('Changes were declined on the TV. Open a new QR code to try again.')
                  : state === 'cancelled'
                    ? tr('Setup was cancelled on the TV. Open a new QR code to try again.')
                    : vpn
                      ? tr('Sent. Confirm “Use profile” on your TV.')
                      : settings
                      ? tr('Sent. Confirm “Apply settings” on your TV.')
                      : tr('Sent. Confirm “Add source” on your TV.');
        finished = ['saved', 'rejected', 'cancelled'].includes(state);
    }
    async function poll() {
        if (finished) return;
        try {
            render(await request());
        } catch (error) {
            status.textContent =
                error instanceof Error
                    ? tr(error.message)
                    : tr('Connection interrupted.');
            if (finished) form.hidden = true;
        }
        if (!finished) setTimeout(poll, 1500);
    }
    form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        const values = new FormData(form);
        const data: Record<string, string> = {};
        values.forEach((value, key) => {
            data[key] = String(value);
        });
        sent = true;
        try {
            render(
                await request(
                    'POST',
                    vpn
                        ? { config: data.config, name: data.name }
                        : settings
                        ? {
                              layout: data.layout,
                              epg: values.has('epg'),
                              tmdb: {
                                  enabled: values.has('enabled'),
                                  language: data.language,
                                  apiKey: data.apiKey,
                              },
                          }
                        : data
                )
            );
            form.reset();
        } catch (error) {
            // A lost response may still mean delivery; polling retrieves its receipt.
            sent = false;
            status.textContent =
                error instanceof Error
                    ? tr(error.message)
                    : tr('Could not send. Retry.');
            submit.disabled = finished;
        }
    };
    if (!id || !token) {
        finished = true;
        form.hidden = true;
        status.textContent =
            tr('Open a new QR code on the TV. This page needs a one-time setup link.');
    } else void poll();
}

phoneClient();
