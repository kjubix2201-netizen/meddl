import { useEffect, useRef, useState } from 'preact/hooks';
import { PlayerBar, type PlayerBarCommand, type PlayerBarState } from './desktop-player-bar';

type OverlayView = {
    onState: (callback: (state: unknown) => void) => () => void;
    command: (command: PlayerBarCommand) => void;
};

function controlsScale(): number {
    const fit = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    return Math.max(0.55, Math.min(1, Math.round(fit * 100) / 100));
}

function overlayView(): OverlayView | undefined {
    return (window as unknown as { meddlDesktop?: { overlayView?: OverlayView } }).meddlDesktop?.overlayView;
}

/**
 * The page of the desktop app's see-through overlay window (apps/tv with
 * ?overlay=player, services/player-overlay-window.ts): the player bar over
 * the video with the picture showing through, like YouTube. It shows what
 * the main window's player sends and sends clicks back; a click on the
 * picture beside the controls closes them, moving the mouse brings them back.
 */
export function PlayerOverlayView() {
    const [state, setState] = useState<PlayerBarState | null>(null);
    const lastMove = useRef(0);
    const view = overlayView();
    useEffect(() => view?.onState((next) => setState(next as PlayerBarState)), []);
    const send = (command: PlayerBarCommand) => view?.command(command);
    // The pointer rests on a button or the timeline: the controls stay
    // (they used to fade away under the pointer, and the next click missed).
    const [hovering, setHovering] = useState(false);
    // Laid out for a 1920 × 1080 window: smaller windows (or Windows display
    // scaling, e.g. 150 % on a 24-inch screen) scale the controls down with
    // them instead of making them crowd and cut off.
    const [scale, setScale] = useState(controlsScale());
    useEffect(() => {
        const resize = () => setScale(controlsScale());
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    useEffect(() => {
        if (!hovering) return;
        send({ type: 'activity' });
        const timer = setInterval(() => send({ type: 'activity' }), 1500);
        return () => clearInterval(timer);
    }, [hovering]);
    const moved = () => {
        const now = Date.now();
        if (now - lastMove.current < 250) return;
        lastMove.current = now;
        send({ type: 'activity' });
    };
    return (
        <div
            class={`player-overlay ${state?.shown ? '' : 'dormant'}`}
            style={{ zoom: scale }}
            onMouseMove={moved}
            onMouseOver={(event) =>
                setHovering(!!(event.target as HTMLElement).closest('button, input, .dp-menu, .dp-timeline'))
            }
            onMouseLeave={() => setHovering(false)}
            onDblClick={(event) => {
                // A double-click on the picture: full screen on / off.
                if ((event.target as HTMLElement).closest('button, input, .next-banner, .dp-menu, .dp-timeline')) return;
                send({ type: 'fullscreen' });
            }}
            onClick={(event) => {
                // Pause and play only with the button in the middle. A click
                // anywhere else on the picture closes the controls (or
                // brings them back while they are hidden).
                const target = event.target as HTMLElement;
                if (target.closest('button, input, .next-banner, .dp-menu')) return;
                send({ type: state?.shown ? 'hide' : 'activity' });
            }}
        >
            {state ? <PlayerBar state={state} send={send} /> : null}
        </div>
    );
}
