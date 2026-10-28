/**
 * Provider requests without a meddl server. A web page may not read answers
 * from IPTV providers (they send no CORS headers), so the native app shells
 * offer a direct line: the Android TV app answers same-origin requests to
 * `/__meddl/fetch` by fetching the target itself (MainActivity), the
 * desktop app exposes the same through its preload bridge, and pages the
 * desktop app shares in the home network (phones, the iPhone home screen
 * app) get `/__meddl/fetch` from its home network server.
 */
type AndroidShell = { hasDirectFetch?: () => boolean };
type DesktopShell = {
    directFetch?: (
        url: string,
        headers: Record<string, string>,
        timeoutMs: number
    ) => Promise<{ status: number; body: string }>;
};

type ServedPage = { directFetch?: boolean };

function shells() {
    const w = window as unknown as { MeddlAndroid?: AndroidShell; meddlDesktop?: DesktopShell; meddlServed?: ServedPage };
    return { android: w.MeddlAndroid, desktop: w.meddlDesktop, served: w.meddlServed };
}

/** True on a page the desktop app shares in the home network. */
export function servedByMeddlApp(): boolean {
    return typeof window !== 'undefined' && shells().served?.directFetch === true;
}

/** True inside a meddl app that talks to providers itself. */
export function localServerAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    const { android, desktop, served } = shells();
    if (served?.directFetch === true) return true;
    try {
        if (android?.hasDirectFetch?.()) return true;
    } catch {
        // Older app versions have no direct line.
    }
    return typeof desktop?.directFetch === 'function';
}

export interface DirectResponse {
    status: number;
    text: string;
}

/** GET a provider address through the app's direct line. */
export async function directFetch(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    timeoutMs: number
): Promise<DirectResponse> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { desktop } = shells();
    if (desktop?.directFetch) {
        const result = await desktop.directFetch(url, headers, timeoutMs);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return { status: result.status, text: result.body };
    }
    const query = new URLSearchParams({ u: url, h: JSON.stringify(headers), t: String(timeoutMs) });
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal.addEventListener('abort', cancel);
    const timer = setTimeout(cancel, timeoutMs + 5000);
    try {
        const response = await fetch(`/__meddl/fetch?${query}`, { signal: abort.signal, cache: 'no-store' });
        if (response.headers.get('X-Meddl-Fetch-Error'))
            throw new Error(`Provider not reachable: ${response.headers.get('X-Meddl-Fetch-Error')}`);
        return { status: response.status, text: await response.text() };
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}
