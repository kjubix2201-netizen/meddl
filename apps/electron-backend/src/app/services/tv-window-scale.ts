/**
 * The TV interface is laid out for a 1280 px wide screen, like on the
 * Android TV app. The desktop window zooms the page to its width, so the
 * Windows app looks exactly like the TV version at any window size, from a
 * small window to full screen (F11). The embedded MPV player already turns
 * page zoom into native coordinates (embedded-mpv-bounds.util.ts).
 */
import type { BrowserWindow } from 'electron';

export const TV_LAYOUT_WIDTH = 1280;

export function tvZoomFactor(contentWidth: number): number {
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
    return Math.min(3, Math.max(0.5, Math.round((contentWidth / TV_LAYOUT_WIDTH) * 1000) / 1000));
}

export function attachTvWindowScale(win: BrowserWindow): void {
    const apply = () => {
        if (win.isDestroyed()) return;
        const factor = tvZoomFactor(win.getContentBounds().width);
        if (Math.abs(win.webContents.getZoomFactor() - factor) > 0.001) win.webContents.setZoomFactor(factor);
    };
    win.on('resize', apply);
    win.on('enter-full-screen', apply);
    win.on('leave-full-screen', apply);
    win.webContents.on('did-finish-load', apply);
    // Ctrl + / Ctrl − would fight the fitted zoom.
    win.webContents.on('zoom-changed', () => setTimeout(apply, 0));
    apply();
}
