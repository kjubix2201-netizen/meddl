import type { Media } from '@meddl/tv/util';

const KEY = 'meddl-recent-channels';
const LIMIT = 12;

/**
 * The live channels watched last on this device, newest first, for the Home
 * row "Recently watched channels". Kept in this device's storage only: it
 * is a shortcut, not viewing history that travels with the profile.
 */
function read(): Media[] {
    try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string' && m.kind === 'live') : [];
    } catch {
        return [];
    }
}

export function rememberChannel(item: Media) {
    if (item.kind !== 'live') return;
    try {
        const list = [item, ...read().filter((m) => m.id !== item.id)].slice(0, LIMIT);
        localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
        // Storage full or blocked: the row simply stays as it was.
    }
}

export function recentChannels(sourceId: string): Media[] {
    return read().filter((m) => m.sourceId === sourceId);
}
