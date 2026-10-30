import { useEffect, useRef, useState } from 'preact/hooks';
import { PlayerBar, type PlayerBarCommand, type PlayerBarState } from './desktop-player-bar';

type OverlayView = {
    onState: (callback: (state: unknown) => void) => () => void;
    command: (command: PlayerBarCommand) => void;
};

function overlayView(): OverlayView | undefined {
    return (window as unknown as { meddlDesktop?: { overlayView?: OverlayView } }).meddlDesktop?.overlayView;
}

/**
 * The page of the desktop app's see-through overlay window (apps/tv with
 * ?overlay=player, services/player-overlay-window.ts): the player bar over
 * the video with the picture showing through, like YouTube. It shows what
 * the main window's player sends and sends clicks back; a click on the
 * picture pauses or plays, moving the mouse brings the controls back.
 */
export function PlayerOverlayView() {
    const [state, setState] = useState<PlayerBarState | null>(null);
    const lastMove = useRef(0);
    const view = overlayView();
    useEffect(() => view?.onState((next) => setState(next as PlayerBarState)), []);
    const send = (command: PlayerBarCommand) => view?.command(command);
    const moved = () => {
        const now = Date.now();
        if (now - lastMove.current < 250) return;
        lastMove.current = now;
        send({ type: 'activity' });
    };
    return (
        <div
            class={`player-overlay ${state?.shown ? '' : 'dormant'}`}
            onMouseMove={moved}
            onClick={(event) => {
                // The controls cover the whole picture: a click anywhere
                // but on a button or slider pauses or plays.
                const target = event.target as HTMLElement;
                if (!target.closest('button, input, .next-banner')) send({ type: 'toggle' });
            }}
        >
            {state ? <PlayerBar state={state} send={send} /> : null}
        </div>
    );
}
