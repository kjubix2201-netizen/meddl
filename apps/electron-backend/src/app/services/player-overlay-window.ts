/**
 * See-through controls over the meddl player (desktop-player.tsx). MPV
 * paints the picture into a native child window that covers the page, so
 * nothing the page draws can sit on top of the video. This transparent,
 * frameless window, owned by the main window, lies exactly over it and shows
 * the player bar with the picture visible behind it, like YouTube or a TV
 * player. It never takes the keyboard (focusable: false): keys stay with the
 * main window, clicks and mouse moves come back as commands.
 *
 * The page sends the bar state ('meddl:overlay-state'); the overlay page
 * (apps/tv with ?overlay=player) sends commands ('meddl:overlay-command'),
 * which are forwarded to the main window's page.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { join, resolve } from 'node:path';

export const OVERLAY_OPEN = 'meddl:overlay-open';
export const OVERLAY_CLOSE = 'meddl:overlay-close';
export const OVERLAY_STATE = 'meddl:overlay-state';
export const OVERLAY_COMMAND = 'meddl:overlay-command';

let overlay: BrowserWindow | null = null;
let owner: BrowserWindow | null = null;
let lastState: unknown = null;
let detach: (() => void) | null = null;

function overlayUrl(): { file?: string; url?: string } {
    const development = 'ELECTRON_IS_DEV' in process.env ? process.env.ELECTRON_IS_DEV === '1' : !app.isPackaged;
    if (development) return { url: 'http://localhost:4200/?overlay=player' };
    return { file: resolve(__dirname, '..', 'tv', 'index.html') };
}

function follow(win: BrowserWindow, view: BrowserWindow) {
    const place = () => {
        if (win.isDestroyed() || view.isDestroyed()) return;
        if (win.isMinimized() || !win.isVisible()) {
            view.hide();
            return;
        }
        view.setBounds(win.getContentBounds());
        if (!view.isVisible()) view.showInactive();
    };
    const events = ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'restore', 'minimize', 'show', 'hide'] as const;
    events.forEach((name) => win.on(name as 'move', place));
    place();
    return () => events.forEach((name) => win.removeListener(name as 'move', place));
}

export function openPlayerOverlay(win: BrowserWindow): boolean {
    if (overlay && !overlay.isDestroyed()) return true;
    owner = win;
    lastState = null;
    const view = new BrowserWindow({
        parent: win,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: join(__dirname, 'main.preload.js'),
        },
    });
    view.setMenu(null);
    overlay = view;
    const target = overlayUrl();
    const loaded = target.url ? view.loadURL(target.url) : view.loadFile(target.file!, { query: { overlay: 'player' } });
    void loaded
        .then(() => {
            if (view.isDestroyed()) return;
            detach = follow(win, view);
            if (lastState) view.webContents.send(OVERLAY_STATE, lastState);
        })
        .catch(() => closePlayerOverlay());
    view.on('closed', () => {
        if (overlay === view) overlay = null;
    });
    win.once('closed', () => closePlayerOverlay());
    return true;
}

export function closePlayerOverlay(): void {
    detach?.();
    detach = null;
    const view = overlay;
    overlay = null;
    lastState = null;
    if (view && !view.isDestroyed()) view.destroy();
}

export function registerPlayerOverlayHandlers(): void {
    ipcMain.handle(OVERLAY_OPEN, (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? openPlayerOverlay(win) : false;
    });
    ipcMain.handle(OVERLAY_CLOSE, () => closePlayerOverlay());
    // Page → overlay: what the bar shows.
    ipcMain.on(OVERLAY_STATE, (event, state: unknown) => {
        if (!owner || event.sender !== owner.webContents) return;
        lastState = state;
        if (overlay && !overlay.isDestroyed()) overlay.webContents.send(OVERLAY_STATE, state);
    });
    // Overlay → page: a click, a drag on the timeline, a mouse move.
    ipcMain.on(OVERLAY_COMMAND, (event, command: unknown) => {
        if (!overlay || event.sender !== overlay.webContents || !owner || owner.isDestroyed()) return;
        if (!command || typeof command !== 'object') return;
        owner.webContents.send(OVERLAY_COMMAND, command);
    });
}
