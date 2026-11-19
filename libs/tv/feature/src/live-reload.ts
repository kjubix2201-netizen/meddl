/** Live: reloads after a dropped stream, at most this often in this time. */
export const LIVE_DROP_LIMIT = 6;
export const LIVE_DROP_WINDOW_MS = 2 * 60 * 1000;
/** A new link that takes longer is not waited for: the last one is tried. */
export const LIVE_LINK_TIMEOUT_MS = 4000;

/**
 * Live in the desktop player: a stream that drops (the provider ends it, a
 * short network gap) is loaded again instead of closing the player; only
 * when it keeps failing does the player give up. Every reload first asks
 * for the channel's link again: links expire on many providers, and the old
 * one would then fail every time.
 */
export class LiveReload {
    private drops: number[] = [];
    private previous = '';
    /** A drop is covered: the player shows "loading" until the stream answers. */
    private reloading = false;
    /** A reload is on its way (its delay, or the wait for the new link). */
    private pending = false;
    private stopped = false;
    private link?: string;

    constructor(
        /** Loads the stream again, from this link when there is a new one. */
        private readonly reload: (link?: string) => void,
        private readonly freshLink?: (signal: AbortSignal) => Promise<string | undefined>
    ) {}

    /**
     * Takes every status the player reports. True while a reload covers a
     * drop: the player then shows "loading" instead of the end or the error.
     */
    observe(status: string): boolean {
        const changed = status !== this.previous;
        this.previous = status;
        if (status === 'playing' || status === 'loading') this.reloading = false;
        if (status !== 'ended' && status !== 'error') return false;
        // Only the change into "ended"/"error" counts; MPV repeats the state
        // with every property update until the stream loads again.
        if (this.reloading || (changed && this.schedule())) {
            this.reloading = true;
            return true;
        }
        return false;
    }

    /** Play after the player gave up: a new start, counted from zero. */
    retry() {
        if (this.stopped || this.pending) return;
        this.drops = [];
        this.pending = true;
        this.reloading = true;
        void this.run(true);
    }

    /** The player closes: nothing is loaded any more. */
    stop() {
        this.stopped = true;
        this.reloading = false;
    }

    private schedule(): boolean {
        if (this.stopped) return false;
        // The app's own reconnect may answer in between; one reload is enough.
        if (this.pending) return true;
        const now = Date.now();
        this.drops = this.drops.filter((at) => now - at < LIVE_DROP_WINDOW_MS);
        if (this.drops.length >= LIVE_DROP_LIMIT) return false;
        this.drops.push(now);
        this.pending = true;
        setTimeout(() => void this.run(false), this.drops.length > 1 ? 1500 : 300);
        return true;
    }

    private async run(asked: boolean) {
        const link = await this.newLink();
        this.pending = false;
        if (this.stopped) return;
        // It came back by itself meanwhile: a reload would only interrupt it.
        if (!asked && (this.previous === 'playing' || this.previous === 'paused')) return;
        if (link) this.link = link;
        // The next "ended"/"error" counts again, even without "loading" between.
        this.previous = 'loading';
        this.reloading = false;
        this.reload(this.link);
    }

    /** The channel's link, asked again; nothing when that fails or takes long. */
    private newLink(): Promise<string | undefined> {
        const ask = this.freshLink;
        if (!ask) return Promise.resolve(undefined);
        const abort = new AbortController();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                abort.abort();
                resolve(undefined);
            }, LIVE_LINK_TIMEOUT_MS);
            const done = (link?: string) => {
                clearTimeout(timer);
                resolve(link || undefined);
            };
            try {
                ask(abort.signal).then(done, () => done());
            } catch {
                done();
            }
        });
    }
}
