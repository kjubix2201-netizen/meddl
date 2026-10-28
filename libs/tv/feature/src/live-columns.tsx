import { categoryCountry } from '@meddl/shared/m3u-utils';
import { ChannelLogo, Empty, Flag, TvIcon, VirtualCollection } from '@meddl/tv/ui';
import { channelBadges, t, tn } from '@meddl/tv/util';
import { categoryKey, useLiveBrowse } from './use-live-browse';
import type { TvModel } from './use-tv';
import { ALL_COUNTRIES } from './country-catalog';
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
    return (
        <>
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
                                <Flag country={categoryCountry(category.name)} />
                                <span class="live-category-copy">
                                    <strong>{category.name}</strong>
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
                        <Flag country={categoryCountry(browse.categoryName)} />
                        {browse.categoryName}
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
                                    <ChannelLogo src={item.poster} />
                                    <span class="channel-tile-copy">
                                        <strong>{item.title}</strong>
                                        <small>
                                            {playing
                                                ? confirmed
                                                    ? t('● Playing')
                                                    : t('Starting…')
                                                : t('Channel {number}', {
                                                      number: n + 1,
                                                  })}
                                        </small>
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
