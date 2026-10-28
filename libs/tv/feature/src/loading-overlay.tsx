import { useEffect, useRef, useState } from 'preact/hooks';
import { TvIcon, focusKey, restoreFocus } from '@meddl/tv/ui';
import { t, tn, tvLocale } from '@meddl/tv/util';
import type { WarmStep } from './use-provider';
import type { TvModel } from './use-tv';

const SKIP_AFTER_MS = 20000;

const LABELS: Partial<Record<WarmStep['kind'], [string, string, string]>> = {
    live: ['Live TV', '{count} channel', '{count} channels'],
    movie: ['Movies', '{count} title', '{count} titles'],
    series: ['Series', '{count} series', '{count} series'],
};

function StepRow({ step }: { step: WarmStep }) {
    const [title, one, many] = LABELS[step.kind] ?? LABELS.movie!;
    return (
        <li class={`loading-step is-${step.state}`}>
            <span class="loading-step-icon" aria-hidden="true">
                {step.state === 'done' ? (
                    <TvIcon name="check" />
                ) : step.state === 'failed' ? (
                    <TvIcon name="close" />
                ) : step.state === 'loading' ? (
                    <span class="spinner" />
                ) : (
                    <span class="loading-dot" />
                )}
            </span>
            <strong>{t(title)}</strong>
            <small>
                {step.state === 'done' && step.total !== undefined
                    ? tn(step.total, one, many, { count: step.total.toLocaleString(tvLocale()) })
                    : step.state === 'failed'
                      ? t('Loads when opened')
                      : step.state === 'loading'
                        ? t('Loading…')
                        : t('Waiting')}
            </small>
        </li>
    );
}

/**
 * Blocking window while the source connects and its sections load once.
 * It covers the whole app (pointer and remote), so no tab can be opened
 * half-loaded; after 20 s a button lets the viewer continue anyway.
 */
export function LoadingOverlay({ tv }: { tv: TvModel }) {
    const { phase, steps } = tv.warm;
    const open = tv.storageReady && phase !== 'idle';
    const panel = useRef<HTMLDivElement>(null);
    const previous = useRef('');
    const [seconds, setSeconds] = useState(0);
    const canSkip = seconds * 1000 >= SKIP_AFTER_MS;
    useEffect(() => {
        if (!open) return;
        previous.current = focusKey();
        setSeconds(0);
        panel.current?.focus();
        const started = Date.now();
        const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
        return () => {
            clearInterval(timer);
            restoreFocus(previous.current || 'launcher:live', 'launcher:live');
        };
    }, [open]);
    useEffect(() => {
        if (canSkip) restoreFocus('loading:skip');
    }, [canSkip]);
    if (!open) return null;
    const done = steps.filter((s) => s.state === 'done' || s.state === 'failed').length;
    const share = steps.length ? done / steps.length : 0;
    return (
        <div class="loading-overlay" data-tv-modal role="dialog" aria-modal="true" aria-labelledby="loading-title">
            <div class="loading-panel" ref={panel} tabIndex={-1}>
                <span class="spinner large" aria-hidden="true" />
                <h2 id="loading-title">
                    {phase === 'connecting' ? t('Connecting to your source…') : t('Loading your channels…')}
                </h2>
                <p class="muted">
                    {phase === 'connecting' && seconds >= 15
                        ? t('Your provider is answering slowly ({seconds} s). Close meddl in other browsers and apps, so only one connection is open.', { seconds })
                        : t('This happens once per start. Everything opens instantly afterwards.')}
                </p>
                {steps.length ? (
                    <>
                        <div class="loading-progress" aria-hidden="true">
                            <span style={{ width: `${Math.max(6, share * 100)}%` }} />
                        </div>
                        <ul class="loading-steps">
                            {steps.map((step) => (
                                <StepRow key={step.kind} step={step} />
                            ))}
                        </ul>
                    </>
                ) : null}
                {canSkip ? (
                    <button class="primary" data-focus="loading:skip" onClick={tv.skipWarm}>
                        {t('Continue, keep loading in the background')}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
