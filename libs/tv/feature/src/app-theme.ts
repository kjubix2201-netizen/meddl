/**
 * Designs (Settings → Appearance): each one re-tints the app's surfaces and
 * text (apps/tv/src/themes.css) through `data-theme` on the page. The choice
 * is kept on this device and applied before the first picture, so the app
 * never flashes in another design.
 */
export const APP_THEMES = [
    { id: 'meddl', name: 'meddl', preview: ['#1f1d2b', '#2d2b3c', '#0d0b14'] },
    { id: 'midnight', name: 'Midnight', preview: ['#1a202e', '#272f40', '#090c16'] },
    { id: 'emerald', name: 'Emerald', preview: ['#1b2a27', '#283a37', '#0a1413'] },
    { id: 'bordeaux', name: 'Bordeaux', preview: ['#2d1b1f', '#3f282e', '#150a0b'] },
    { id: 'graphite', name: 'Graphite', preview: ['#222326', '#323335', '#0f0f10'] },
    { id: 'oled', name: 'OLED black', preview: ['#0a0a0a', '#0e0e0f', '#000000'] },
] as const;

export type AppThemeId = (typeof APP_THEMES)[number]['id'];

const KEY = 'meddl-theme';

export function savedTheme(): AppThemeId {
    try {
        const value = localStorage.getItem(KEY);
        if (APP_THEMES.some((theme) => theme.id === value)) return value as AppThemeId;
    } catch {
        // Storage blocked: the default design.
    }
    return 'meddl';
}

export function applyTheme(id: AppThemeId = savedTheme()) {
    const root = document.documentElement;
    if (id === 'meddl') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', id);
}

export function chooseTheme(id: AppThemeId) {
    try {
        localStorage.setItem(KEY, id);
    } catch {
        // Not kept, but shown until the app closes.
    }
    applyTheme(id);
    // The Windows app's player controls live in their own window.
    window.dispatchEvent(new CustomEvent('meddl:theme', { detail: id }));
}
