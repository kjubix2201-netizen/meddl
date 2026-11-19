/**
 * Background work (opening the big film and series lists, refreshing an
 * outdated list) waits until the viewer pauses: parsing tens of thousands
 * of titles takes the TV's only thread for a moment, and while the remote
 * is in use that shows as stutter. Any key, click, touch or wheel counts as
 * activity.
 */
let lastInput = 0;
let listening = false;

function listen() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    const mark = () => {
        lastInput = Date.now();
    };
    for (const name of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
        window.addEventListener(name, mark, { capture: true, passive: true });
    }
}
listen();

/**
 * Resolves once nothing was pressed for `quietMs` (and the browser is idle),
 * and after `maxWaitMs` at the latest: work that others wait for must not
 * depend on the viewer ever pausing.
 */
export function untilUserIdle(quietMs: number, signal?: AbortSignal, maxWaitMs = Infinity): Promise<void> {
    listen();
    const latest = Date.now() + maxWaitMs;
    return new Promise((resolve) => {
        const check = () => {
            if (signal?.aborted) return resolve();
            const now = Date.now();
            if (now >= latest) return resolve();
            const waited = now - lastInput;
            if (waited < quietMs) {
                setTimeout(check, Math.min(Math.max(250, quietMs - waited), latest - now));
                return;
            }
            if (typeof window === 'undefined') return resolve();
            const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
                .requestIdleCallback;
            if (idle) idle(() => resolve(), { timeout: 1000 });
            else resolve();
        };
        check();
    });
}
