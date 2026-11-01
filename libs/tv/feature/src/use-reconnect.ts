import { t } from '@meddl/tv/util';
import { useEffect, useRef, useState } from 'preact/hooks';
import { RECONNECT_DELAYS } from './reconnect-policy';
export { RECONNECT_DELAYS, shouldRetryOnResume } from './reconnect-policy';

/**
 * Reconnects only when the viewer presses "Reconnect" (no automatic
 * attempts, RECONNECT_DELAYS is empty); the status line stays empty.
 */
export function useReconnect(options: {
    key: string;
    enabled: boolean;
    failed: boolean;
    busy: boolean;
    playing: boolean;
    ready: number;
    retry: () => void;
}) {
    const latest = useRef(options);
    latest.current = options;
    const attempts = useRef(0);
    const [wake, setWake] = useState(0);
    const [status, setStatus] = useState('');
    useEffect(() => {
        attempts.current = 0;
    }, [options.key]);
    useEffect(() => {
        if (!options.ready || options.failed || options.busy) return;
        const timer = setTimeout(() => {
            attempts.current = 0;
        }, 60000);
        return () => clearTimeout(timer);
    }, [options.ready, options.failed, options.busy]);
    useEffect(() => {
        const resume = () => {
            if (document.hidden || navigator.onLine === false) {
                setWake((n) => n + 1);
                return;
            }
            // No automatic reconnect here either: the viewer presses "Reconnect".
            attempts.current = 0;
            setWake((n) => n + 1);
        };
        window.addEventListener('online', resume);
        window.addEventListener('offline', resume);
        document.addEventListener('visibilitychange', resume);
        return () => {
            window.removeEventListener('online', resume);
            window.removeEventListener('offline', resume);
            document.removeEventListener('visibilitychange', resume);
        };
    }, []);
    useEffect(() => {
        if (
            !options.enabled ||
            !options.failed ||
            options.busy ||
            options.playing
        ) {
            setStatus('');
            return;
        }
        if (document.hidden || navigator.onLine === false) {
            setStatus(t('Waiting for the TV network.'));
            return;
        }
        const delay = RECONNECT_DELAYS[attempts.current];
        // No automatic retries (RECONNECT_DELAYS is empty): only "Reconnect".
        if (delay === undefined) {
            setStatus('');
            return;
        }
        setStatus(
            t('Reconnecting in {seconds} seconds ({attempt}/{total})…', {
                seconds: delay / 1000,
                attempt: attempts.current + 1,
                total: RECONNECT_DELAYS.length,
            })
        );
        const timer = setTimeout(() => {
            const current = latest.current;
            if (
                document.hidden ||
                navigator.onLine === false ||
                current.playing ||
                current.busy
            )
                return;
            attempts.current++;
            current.retry();
        }, delay);
        return () => clearTimeout(timer);
    }, [
        options.enabled,
        options.failed,
        options.busy,
        options.playing,
        options.key,
        wake,
    ]);
    return {
        reconnectStatus: status,
        resetReconnect: () => {
            attempts.current = 0;
            setWake((n) => n + 1);
        },
    };
}
