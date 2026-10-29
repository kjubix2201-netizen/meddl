import { categoryCountry } from '@meddl/shared/m3u-utils';
import { ChannelLogo, Empty, Flag, TvIcon, VirtualCollection } from '@meddl/tv/ui';
import { channelBadges, displayCategoryName, displayChannelName, t, tn } from '@meddl/tv/util';
import { categoryKey, useLiveBrowse } from './use-live-browse';
import type { TvModel } from './use-tv';
import { ALL_COUNTRIES } from './country-catalog';
import { useGridGuide } from './use-grid-guide';
import { CountryFlag, countryLabel } from './country-picker';

/**
 * Live TV, first two columns: countries / categories with flags on the left,
 * the selected category's channels as cards in the middle. Both stay
 * visible; OK on a category opens its channels, Back from a channel returns
 * to its category (same state machine as the single-pane overlay).
 */
export function LiveColumns({
    tv,
    browse,
}: {
    tv: TvModel;
    browse: ReturnType<typeof useLiveBrowse>;
}) {
    const items = tv.catalog.items;
    const favorites = new Set(tv.data.favorites.map((m) => m.id));
    // "Now on" for the channels around the focused one (what is on screen),
    // loaded one by one like the TV guide and cached for five minutes.
    const at = Math.max(0, items.findIndex((m) => m.id === tv.selected?.id));
    const nearby = items.slice(Math.max(0, at - 4), at + 9).filter((m) => m.kind === 'live');
    const { schedules } = useGridGuide(tv.guideClient, nearby, !!tv.data.epg);
    const now = Date.now();
    const oneCountry = !!tv.route.country && tv.route.country !== ALL_COUNTRIES;
    return (
        <>
            {/* Wide screens: back and the title over the rail, in place of the menu. */}
            <header class="live-title">
                <button class="round" data-focus="live-back" aria-label={t('Back')} onClick={tv.back}>
                    <TvIcon name="back" />
                </button>
                <span class="live-title-copy">
                    <strong>{t('Live TV')}</strong>
                    {oneCountry ? <small>{countryLabel(tv.route.country!)}</small> : null}
                </span>
            </header>
            {/* Left rail: all channels of the country, or the favourite channels. */}
            <nav class="live-rail" aria-label={t('Live TV')}>
                <button
                    class="round"
                    data-focus="live-rail:all"
                    aria-label={t('All channels')}
                    aria-pressed={!tv.route.category}
                    onClick={() => browse.choose('')}
                >
                    <TvIcon name="tv-live" />
                </button>
                <button
                    class="round"
                    data-focus="live-rail:favorites"
                    aria-label={t('Favorite channels')}
                    onClick={() => {
                        tv.navigate('favorites');
                        tv.setRoute({ ...tv.route, view: 'favorites', kind: 'live', category: '', page: 0, query: '' });
                    }}
                >
                    <TvIcon name="star" />
                </button>
            </nav>
            <section class="category-column" aria-label={t('Channel categories')}>
                <h2>
                    {tv.route.country && tv.route.country !== ALL_COUNTRIES ? (
                        <>
                            <CountryFlag code={tv.route.country} />
                            {countryLabel(tv.route.country)}
                        </>
                    ) : (
                        t('Live TV')
                    )}
                </h2>
                <div class="channels category-list">
                    <VirtualCollection
                        layout="channels"
                        items={browse.categories}
                        restoreKey={categoryKey(tv.route.category)}
                        restoreScroll={browse.categoryScroll}
                        render={(category) => (
                            <button
                                class="live-category"
                                data-focus={category.id}
                                aria-pressed={category.categoryId === tv.route.category}
                                onClick={() => browse.choose(category.categoryId)}
                            >
                                {/* Inside one country every row had the same flag. */}
                                {oneCountry ? (
                                    <span class="category-initial" aria-hidden="true">
                                        {category.categoryId ? (
                                            displayCategoryName(category.name).slice(0, 1).toUpperCase()
                                        ) : (
                                            <TvIcon name="tv-live" />
                                        )}
                                    </span>
                                ) : (
                                    <Flag country={categoryCountry(category.name)} />
                                )}
                                <span class="live-category-copy">
                                    <strong>{displayCategoryName(category.name)}</strong>
                                    {category.categoryId === tv.route.category &&
                                    !tv.catalogBusy ? (
                                        <small>
                                            {tn(
                                                tv.catalog.total,
                                                '{count} channel',
                                                '{count} channels'
                                            )}
                                        </small>
                                    ) : null}
                                </span>
                            </button>
                        )}
                    />
                </div>
            </section>
            <section
                class="channel-pane channel-column"
                aria-label={t('Channels')}
                onFocusCapture={browse.enterChannels}
            >
                <div class="channel-pane-header">
                    <button
                        data-focus="live-categories"
                        onClick={browse.back}
                        aria-label={t('Back to categories')}
                    >
                        {oneCountry ? null : <Flag country={categoryCountry(browse.categoryName)} />}
                        {displayCategoryName(browse.categoryName)}
                    </button>
                    <span class="muted">{t('OK: preview · OK again: fullscreen')}</span>
                </div>
                <div class="channels" key={tv.catalogKey}>
                    <VirtualCollection
                        layout="channels"
                        items={items}
                        more={tv.hasMore}
                        busy={tv.catalogBusy}
                        error={tv.catalogError}
                        loadMore={tv.loadMore}
                        restoreKey={browse.channelKey}
                        restoreScroll={browse.channelScroll}
                        render={(item, n) => {
                            const playing = tv.playing?.id === item.id;
                            const confirmed =
                                playing && tv.player.current?.hasConfirmedPlayback;
                            const running = schedules
                                .get(item.id)
                                ?.programs.find((p) => p.start <= now && p.end > now);
                            return (
                                <button
                                    class={`channel channel-tile ${confirmed ? 'is-playing' : ''}`}
                                    data-focus={item.id}
                                    aria-pressed={tv.selected?.id === item.id}
                                    onFocus={() => tv.setSelected(item)}
                                    onClick={() => {
                                        tv.setSelected(item);
                                        void tv.play(item);
                                    }}
                                >
                                    <span class="channel-number">{n + 1}</span>
                                    <ChannelLogo src={item.poster} name={displayChannelName(item.title)} />
                                    <span class="channel-tile-copy">
                                        <strong>{displayChannelName(item.title)}</strong>
                                        <small>
                                            {playing
                                                ? confirmed
                                                    ? t('● Playing')
                                                    : t('Starting…')
                                                : running
                                                  ? running.title
                                                  : ''}
                                        </small>
                                        {running ? (
                                            <span class="channel-now" aria-hidden="true">
                                                <span
                                                    style={{
                                                        width: `${Math.min(100, ((now - running.start) / Math.max(1, running.end - running.start)) * 100)}%`,
                                                    }}
                                                />
                                            </span>
                                        ) : null}
                                        <span class="channel-badges">
                                            {channelBadges(item).map((badge) => (
                                                <span class="badge">{badge}</span>
                                            ))}
                                        </span>
                                    </span>
                                    {favorites.has(item.id) ? (
                                        <span class="channel-favorite" aria-label={t('Favorite')}>
                                            <TvIcon name="star" />
                                        </span>
                                    ) : null}
                                </button>
                            );
                        }}
                    />
                    {!tv.busy && !tv.catalogError && !items.length ? (
                        <Empty>{t('No channels in this category.')}</Empty>
                    ) : null}
                </div>
            </section>
        </>
    );
}
