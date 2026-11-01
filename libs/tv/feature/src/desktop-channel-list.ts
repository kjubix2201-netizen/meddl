import { useEffect, useRef, useState } from 'preact/hooks';

/** What the player shows of the channel list: a window of rows around the cursor. */
export interface ChannelListView {
    start: number;
    names: string[];
    at: number;
    playing: number;
}

const ROWS = 15;
const IDLE_MS = 8000;
const BACK = ['Escape', 'Backspace', 'BrowserBack', 'GoBack', 'ArrowLeft'];

/**
 * Live in the Windows app's player: Up / Down open the channels of the
 * category on the left, the arrows move in it, Enter plays the chosen one;
 * Back / Left close it, and it closes by itself after a few quiet seconds.
 */
export function useDesktopChannelList(source: {
    current: {
        onChannels?: () => { names: string[]; index: number };
        onZapTo?: (index: number) => boolean;
    };
}) {
    const [list, setList] = useState<{ names: string[]; playing: number; at: number } | null>(null);
    const current = useRef(list);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const update = (next: typeof list) => {
        current.current = next;
        setList(next);
        clearTimeout(timer.current);
        if (next) timer.current = setTimeout(() => update(null), IDLE_MS);
    };
    useEffect(() => () => clearTimeout(timer.current), []);

    /** Uses the key when the list is open or opens; true when it did. */
    const key = (name: string): boolean => {
        const open = current.current;
        if (!open) {
            if (name !== 'ArrowUp' && name !== 'ArrowDown') return false;
            const data = source.current.onChannels?.();
            if (!data?.names.length) return false;
            const playing = Math.min(Math.max(0, data.index), data.names.length - 1);
            update({ names: data.names, playing, at: playing });
            return true;
        }
        if (name === 'ArrowUp' || name === 'ArrowDown') {
            const at = Math.min(open.names.length - 1, Math.max(0, open.at + (name === 'ArrowDown' ? 1 : -1)));
            update({ ...open, at });
            return true;
        }
        if (name === 'Enter') {
            pick(open.at);
            return true;
        }
        if (BACK.includes(name)) {
            update(null);
            return true;
        }
        return false;
    };
    const pick = (index: number) => {
        const open = current.current;
        update(null);
        if (open && index !== open.playing) source.current.onZapTo?.(index);
    };
    let view: ChannelListView | undefined;
    if (list) {
        const start = Math.max(0, Math.min(list.at - Math.floor(ROWS / 2), list.names.length - ROWS));
        view = { start, names: list.names.slice(start, start + ROWS), at: list.at, playing: list.playing };
    }
    return { key, pick, view };
}
