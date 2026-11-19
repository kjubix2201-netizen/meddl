/**
 * The Windows app's window: full screen on and off (F11, the player's
 * full-screen button, a double-click on the picture). Electron's own
 * transition tracker (window.events.ts) keeps quick presses in order.
 */
type WindowState = { isMaximized: boolean; isFullScreen: boolean };
type WindowBridge = {
    toggleFullScreenWindow?: () => Promise<WindowState>;
    getWindowState?: () => Promise<WindowState>;
    onWindowStateChange?: (callback: (state: WindowState) => void) => () => void;
};

function bridge(): WindowBridge | undefined {
    return (window as unknown as { electron?: WindowBridge }).electron;
}

export function desktopFullscreenAvailable() {
    return typeof bridge()?.toggleFullScreenWindow === 'function';
}

export function toggleDesktopFullscreen() {
    void bridge()
        ?.toggleFullScreenWindow?.()
        .catch(() => undefined);
}

/** Calls back with the window's full-screen state now and on every change. */
export function watchDesktopFullscreen(callback: (fullscreen: boolean) => void): () => void {
    const b = bridge();
    if (!b?.getWindowState) return () => undefined;
    let active = true;
    void b
        .getWindowState()
        .then((state) => active && callback(!!state?.isFullScreen))
        .catch(() => undefined);
    const off = b.onWindowStateChange?.((state) => callback(!!state?.isFullScreen));
    return () => {
        active = false;
        off?.();
    };
}
