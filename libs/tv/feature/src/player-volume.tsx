import { t } from '@meddl/tv/util';
import { useEffect, useState } from 'preact/hooks';
import { TvIcon } from '@meddl/tv/ui';

const STORAGE_KEY = 'meddl-tv-volume';

interface VolumeState {
    level: number;
    muted: boolean;
}

function readStored(): VolumeState {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (saved && typeof saved.level === 'number')
            return {
                level: Math.min(100, Math.max(0, Math.round(saved.level))),
                muted: !!saved.muted,
            };
    } catch {
        // Unavailable or corrupt storage: start at full volume.
    }
    return { level: 100, muted: false };
}

function store(state: VolumeState) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage can be unavailable (private mode, quota); volume still applies.
    }
}

/**
 * Player volume: mute button plus a 0–100 slider. On a remote the slider is
 * focused with Up/Down and changed with Left/Right (native range behavior);
 * "M" toggles mute. The level is remembered between sessions.
 */
export function VolumeControl({ video }: { video: HTMLVideoElement | null }) {
    const [state, setState] = useState(readStored);

    useEffect(() => {
        if (!video) return;
        video.volume = state.level / 100;
        video.muted = state.muted || state.level === 0;
    }, [video, state, video?.currentSrc]);

    const update = (next: VolumeState) => {
        setState(next);
        store(next);
    };

    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLInputElement && target.type !== 'range')
            )
                return;
            if (event.key === 'm' || event.key === 'M' || event.key === 'AudioVolumeMute') {
                event.preventDefault();
                setState((current) => {
                    const next = { ...current, muted: !current.muted };
                    store(next);
                    return next;
                });
            }
        };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, []);

    const silent = state.muted || state.level === 0;
    return (
        <div class="player-volume">
            <button
                data-focus="player-mute"
                aria-label={silent ? t('Unmute') : t('Mute')}
                aria-pressed={silent}
                onClick={() =>
                    update({
                        level: state.level === 0 ? 50 : state.level,
                        muted: !silent,
                    })
                }
            >
                <TvIcon name={silent ? 'muted' : 'volume'} />
            </button>
            <input
                data-focus="player-volume"
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label={t('Volume')}
                value={silent ? 0 : state.level}
                onInput={(event) =>
                    update({
                        level: Number(event.currentTarget.value),
                        muted: false,
                    })
                }
            />
            <span class="player-volume-value">{silent ? 0 : state.level}%</span>
        </div>
    );
}
