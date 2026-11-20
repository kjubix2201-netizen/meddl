/**
 * The app's built-in VPN as the page sees it. Two apps have one: the
 * Android TV / Fire TV app (MeddlVpn.kt, a synchronous bridge) and the
 * desktop app (apps/electron-backend, vpn-tunnel.service.ts, over IPC).
 * Both report the same state and take the same commands; the settings page
 * (vpn-setting.tsx) and the start gate below talk to this one shape.
 */
export interface VpnState {
    available: boolean;
    configured: boolean;
    state: 'down' | 'connecting' | 'up';
    error: string;
    autostart: boolean;
    /** Only through the VPN: meddl waits for the tunnel before loading. */
    lock: boolean;
    name: string;
    server?: string;
}

export interface VpnControl {
    /** How a profile gets here: from the phone (TV) or as a file (computer). */
    readonly source: 'phone' | 'file';
    /** The last state heard of; undefined before the app answered. */
    current(): VpnState | undefined;
    refresh(): Promise<VpnState | undefined>;
    /** '' when the profile was saved, else the reason's code. */
    importProfile(text: string, name: string): Promise<string>;
    connect(): void;
    disconnect(): void;
    remove(): void;
    setAutostart(on: boolean): void;
    setLock(on: boolean): void;
    /** Every change of the VPN, as the app reports it. */
    subscribe(listener: (state: VpnState) => void): () => void;
}

type AndroidVpn = {
    vpnState?: () => string;
    vpnImport?: (text: string, name: string) => string;
    vpnConnect?: () => void;
    vpnDisconnect?: () => void;
    vpnRemove?: () => void;
    vpnSetAutostart?: (on: boolean) => void;
    vpnSetLock?: (on: boolean) => void;
};

type DesktopVpn = {
    state: () => Promise<unknown>;
    importProfile: (text: string, name: string) => Promise<string>;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    remove: () => Promise<void>;
    setAutostart: (on: boolean) => Promise<void>;
    setLock: (on: boolean) => Promise<void>;
    onChange: (callback: (state: unknown) => void) => () => void;
};

function androidControl(shell: AndroidVpn): VpnControl {
    const read = () => {
        try {
            return JSON.parse(shell.vpnState?.() ?? '') as VpnState;
        } catch {
            return undefined;
        }
    };
    return {
        source: 'phone',
        current: read,
        refresh: async () => read(),
        importProfile: async (text, name) => shell.vpnImport?.(text, name) ?? 'invalid',
        connect: () => shell.vpnConnect?.(),
        disconnect: () => shell.vpnDisconnect?.(),
        remove: () => shell.vpnRemove?.(),
        setAutostart: (on) => shell.vpnSetAutostart?.(on),
        setLock: (on) => shell.vpnSetLock?.(on),
        subscribe: (listener) => {
            // The app calls this global (MainActivity).
            const w = window as unknown as { meddlVpnChanged?: (state: VpnState) => void };
            w.meddlVpnChanged = (state) => listener(state);
            return () => {
                delete w.meddlVpnChanged;
            };
        },
    };
}

function desktopControl(bridge: DesktopVpn): VpnControl {
    let last: VpnState | undefined;
    const listeners = new Set<(state: VpnState) => void>();
    const take = (state: unknown) => {
        if (!state || typeof state !== 'object') return;
        last = state as VpnState;
        listeners.forEach((listener) => listener(last as VpnState));
    };
    bridge.onChange(take);
    const quietly = (work: Promise<unknown>) => void work.catch(() => undefined);
    return {
        source: 'file',
        current: () => last,
        refresh: async () => {
            take(await bridge.state().catch(() => undefined));
            return last;
        },
        importProfile: (text, name) => bridge.importProfile(text, name).catch(() => 'failed'),
        connect: () => quietly(bridge.connect()),
        disconnect: () => quietly(bridge.disconnect()),
        remove: () => quietly(bridge.remove()),
        setAutostart: (on) => quietly(bridge.setAutostart(on)),
        setLock: (on) => quietly(bridge.setLock(on)),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

let control: VpnControl | undefined;
let looked = false;

/** The built-in VPN of the app this page runs in, if it has one. */
export function vpnControl(): VpnControl | undefined {
    if (looked || typeof window === 'undefined') return control;
    looked = true;
    const scope = window as unknown as {
        MeddlAndroid?: AndroidVpn;
        meddlDesktop?: { vpn?: DesktopVpn };
    };
    if (typeof scope.MeddlAndroid?.vpnState === 'function') control = androidControl(scope.MeddlAndroid);
    else if (typeof scope.meddlDesktop?.vpn?.state === 'function') control = desktopControl(scope.meddlDesktop.vpn);
    return control;
}

/** True in an app with a built-in VPN (Android TV / Fire TV, desktop). */
export function vpnAvailable(): boolean {
    return !!vpnControl();
}

/** Nothing to wait for: no lock, no profile, no tunnel in this build, or connected. */
function open(state: VpnState | undefined): boolean {
    return !state?.lock || !state.configured || state.available === false || state.state === 'up';
}

/**
 * With "only through the VPN" on: resolves once the tunnel is up (and
 * starts it when needed, asking the TV for permission the first time).
 * Resolves at once without the lock, or when the viewer turns it off.
 */
export async function vpnReady(signal: AbortSignal, waiting: (error: string) => void): Promise<void> {
    const vpn = vpnControl();
    if (!vpn) return;
    let state = vpn.current() ?? (await vpn.refresh());
    if (open(state)) return;
    if (state?.state === 'down') vpn.connect();
    waiting('');
    let asked = Date.now();
    while (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        state = vpn.current() ?? (await vpn.refresh());
        if (open(state)) return;
        waiting(state?.error ?? '');
        // Dropped or refused: try again every 15 s (the viewer may fix it meanwhile).
        if (state?.state === 'down' && Date.now() - asked > 15000) {
            asked = Date.now();
            vpn.connect();
        }
    }
    throw new DOMException('Aborted', 'AbortError');
}
