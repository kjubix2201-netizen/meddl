import type { Media } from './index';

/**
 * Quality / feature badges for a live channel card ("4K", "FHD", "HD",
 * "HEVC", "EPG"), read from the channel name tags providers use and from the
 * provider's EPG id. Order: resolution first, then codec, then EPG.
 */
export function channelBadges(item: Media): string[] {
    const tokens = item.title
        .toUpperCase()
        .split(/[^A-Z0-9+]+/)
        .filter(Boolean);
    const has = (...names: string[]) => names.some((n) => tokens.includes(n));
    const badges: string[] = [];
    if (has('4K', 'UHD', '2160P', '8K')) badges.push('4K');
    else if (has('FHD', '1080P', 'FULLHD')) badges.push('FHD');
    else if (has('HD', '720P', 'HD+')) badges.push('HD');
    if (has('HEVC', 'H265', 'H.265')) badges.push('HEVC');
    const raw = item.raw ?? {};
    const epgId = raw['epg_channel_id'] ?? raw['xmltv_id'] ?? raw['tvg_id'];
    if (typeof epgId === 'string' && epgId.trim()) badges.push('EPG');
    return badges;
}
