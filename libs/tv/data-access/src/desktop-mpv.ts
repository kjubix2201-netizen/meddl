/**
 * The desktop app's built-in MPV player (apps/electron-backend, embedded
 * MPV). It decodes everything the page cannot, Dolby Digital, Dolby Digital
 * Plus and DTS sound included. MPV draws into a native video surface placed
 * over the page at the given bounds; the page keeps the keyboard.
 */
export interface DesktopMpvBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DesktopMpvState {
    id: string;
    status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error' | 'closed';
    positionSeconds: number;
    durationSeconds: number | null;
    /** 0 to 1. */
    volume: number;
    error?: string;
}

export interface DesktopMpvPlayback {
    streamUrl: string;
    title: string;
    isLive?: boolean;
    startTime?: number;
    userAgent?: string;
}

type Bridge = {
    getEmbeddedMpvSupport?: () => Promise<{ supported: boolean; reason?: string }>;
    prepareEmbeddedMpv?: () => Promise<{ supported: boolean; reason?: string }>;
    createEmbeddedMpvSession?: (bounds: DesktopMpvBounds, title?: string, volume?: number) => Promise<DesktopMpvState>;
    loadEmbeddedMpvPlayback?: (id: string, playback: DesktopMpvPlayback) => Promise<unknown>;
    setEmbeddedMpvBounds?: (id: string, bounds: DesktopMpvBounds) => Promise<unknown>;
    setEmbeddedMpvPaused?: (id: string, paused: boolean) => Promise<DesktopMpvState | null>;
    seekEmbeddedMpvBy?: (id: string, seconds: number) => Promise<DesktopMpvState | null>;
    setEmbeddedMpvVolume?: (id: string, volume: number) => Promise<DesktopMpvState | null>;
    disposeEmbeddedMpvSession?: (id: string) => Promise<unknown>;
    onEmbeddedMpvSessionUpdate?: (callback: (state: DesktopMpvState) => void) => (() => void) | void;
};

function bridge(): Bridge | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { electron?: Bridge }).electron;
}

/** True inside the desktop app with the MPV player built in. */
export function desktopMpvAvailable(): boolean {
    const b = bridge();
    return typeof b?.createEmbeddedMpvSession === 'function' && typeof b.loadEmbeddedMpvPlayback === 'function';
}

/** One MPV playback; `stop()` ends it and frees the video surface. */
export class DesktopMpvSession {
    private id = '';
    private stopped = false;
    private unsubscribe: (() => void) | void = undefined;
    state: DesktopMpvState | null = null;

    constructor(private readonly onChange: (state: DesktopMpvState) => void) {}

    async start(bounds: DesktopMpvBounds, playback: DesktopMpvPlayback, volume = 1) {
        const b = bridge();
        if (!b?.createEmbeddedMpvSession || !b.loadEmbeddedMpvPlayback) throw new Error('MPV is not available');
        const prepared = await b.prepareEmbeddedMpv?.();
        if (prepared && !prepared.supported) throw new Error(prepared.reason || 'MPV is not available');
        if (this.stopped) return;
        this.unsubscribe = b.onEmbeddedMpvSessionUpdate?.((state) => {
            if (state.id !== this.id || this.stopped) return;
            this.state = state;
            this.onChange(state);
        });
        const created = await b.createEmbeddedMpvSession(bounds, playback.title, volume);
        this.id = created.id;
        if (this.stopped) {
            await b.disposeEmbeddedMpvSession?.(created.id);
            return;
        }
        this.state = created;
        this.onChange(created);
        await b.loadEmbeddedMpvPlayback(created.id, playback);
    }

    private apply(result: Promise<DesktopMpvState | null> | undefined) {
        void result
            ?.then((state) => {
                if (state && !this.stopped) {
                    this.state = state;
                    this.onChange(state);
                }
            })
            .catch(() => undefined);
    }

    setBounds(bounds: DesktopMpvBounds) {
        if (this.id && !this.stopped) void bridge()?.setEmbeddedMpvBounds?.(this.id, bounds)?.catch(() => undefined);
    }

    togglePause() {
        if (!this.id || !this.state) return;
        this.apply(bridge()?.setEmbeddedMpvPaused?.(this.id, this.state.status !== 'paused'));
    }

    seekBy(seconds: number) {
        if (this.id) this.apply(bridge()?.seekEmbeddedMpvBy?.(this.id, seconds));
    }

    /** Volume runs from 0 to 1. */
    changeVolume(step: number) {
        if (!this.id || !this.state) return;
        const volume = Math.max(0, Math.min(1, Math.round((this.state.volume + step) * 100) / 100));
        this.apply(bridge()?.setEmbeddedMpvVolume?.(this.id, volume));
    }

    async stop() {
        if (this.stopped) return;
        this.stopped = true;
        if (typeof this.unsubscribe === 'function') this.unsubscribe();
        if (this.id) await bridge()?.disposeEmbeddedMpvSession?.(this.id)?.catch(() => undefined);
    }
}
