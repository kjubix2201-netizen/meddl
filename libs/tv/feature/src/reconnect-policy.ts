export const RECONNECT_DELAYS = [2000, 5000, 10000, 30000];

/**
 * Coming back to the app (tab visible again, network back) reconnects only
 * when the connection had actually failed. A working connection keeps its
 * loaded channels instead of starting over.
 */
export function shouldRetryOnResume(state: {
    enabled: boolean;
    failed: boolean;
    busy: boolean;
    playing: boolean;
}): boolean {
    return state.enabled && state.failed && !state.busy && !state.playing;
}
