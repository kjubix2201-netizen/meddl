import { t } from '@meddl/tv/util';
import { TvIcon } from '@meddl/tv/ui';
import { TvModel } from './use-tv';
import { HomeServer } from './home-server';
export function BackendConnection({
    tv,
    label = t('meddl backend URL'),
}: {
    tv: TvModel;
    label?: string;
}) {
    const b = tv.backend;
    return (
        <section class="backend-connection" aria-label={t('Backend connection')}>
            <h2>{t('Connect your home server')}</h2>
            <p class="muted">
                {t('Find meddl on your home network, or enter your server address below.')}
            </p>
            <div
                class={`connection-status ${b.connected ? 'connected' : ''}`}
                role="status"
            >
                {b.connected ? (
                    <TvIcon name="check" />
                ) : (
                    <span class="connection-dot" aria-hidden="true" />
                )}
                {b.status}
            </div>
            <label>
                {label}
                <input
                    data-focus="backend:url"
                    name="backend"
                    type="url"
                    required
                    value={b.url}
                    onInput={(event) => b.editUrl(event.currentTarget.value)}
                    placeholder="http://your-server:3333"
                />
            </label>
            <details>
                <summary data-focus="backend:token-details">
                    {t('Backend access token (if required)')}
                </summary>
                <label>
                    {t('Backend access token')}
                    <input
                        data-focus="backend:token"
                        name="backendToken"
                        type="password"
                        value={b.token}
                        onInput={(event) =>
                            b.editToken(event.currentTarget.value)
                        }
                        autoComplete="off"
                    />
                </label>
            </details>
            <div class="actions">
                <button
                    type="button"
                    data-focus="backend:connect"
                    onClick={() => void b.connect()}
                    disabled={!b.url}
                >
                    {t('Check and connect')}
                </button>
                <button
                    type="button"
                    data-focus="backend:find"
                    onClick={() => (b.searching ? b.cancel() : void b.find())}
                >
                    {b.searching ? t('Cancel search') : t('Find backend')}
                </button>
            </div>
            {b.found.length ? (
                <div class="backend-results">
                    {b.found.map((info) => (
                        <button
                            type="button"
                            key={info.url}
                            data-focus={`backend:found:${info.url}`}
                            onClick={() => b.choose(info)}
                        >
                            {info.url}
                            {info.auth === 'token' ? ' ' + t('· token required') : ''}
                        </button>
                    ))}
                </div>
            ) : null}
            <p class="muted">
                {t('Use a backend you trust: source login details go to this address. Local search checks standard meddl ports; you can always enter another address.')}
            </p>
            <HomeServer tv={tv} />
        </section>
    );
}
