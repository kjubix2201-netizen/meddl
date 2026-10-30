import { t } from '@meddl/tv/util';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
    CachedProvider,
    createProvider,
    LocalTransport,
    localServerAvailable,
    onListOrigin,
    ProviderTransport,
} from '@meddl/tv/data-access';
import type { Kind, ProviderClient, UserData } from '@meddl/tv/util';
import { vpnReady } from './vpn-setting';

export type WarmStep = {
    kind: Kind;
    state: 'waiting' | 'loading' | 'done' | 'failed';
    total?: number;
};
/** Start-up progress for the blocking loading window. */
export type WarmState = {
    /** 'vpn': waiting for the built-in VPN ("only through the VPN"). */
    phase: 'idle' | 'vpn' | 'connecting' | 'loading';
    /** While waiting for the VPN: why it is not up yet. */
    vpnError?: string;
    steps: WarmStep[];
    /** A list is being downloaded (not just opened from this device). */
    downloading?: boolean;
};
const IDLE: WarmState = { phase: 'idle', steps: [] };

export function useProvider(
    data: UserData,
    storageReady: boolean,
    retry: number,
    options: {
        reset: () => void;
        report: (message: string) => void;
        update: (change: (data: UserData) => UserData) => Promise<void>;
    }
) {
    const [ready, setReady] = useState(0);
    const [busy, setBusy] = useState(false);
    const [warm, setWarm] = useState<WarmState>(IDLE);
    const provider = useRef<ProviderClient>();
    const owner = useRef('');
    const callbacks = useRef(options);
    callbacks.current = options;
    const active = data.sources.find((s) => s.id === data.activeId);
    const fingerprint = active
        ? JSON.stringify([
              active.id,
              active.provider,
              active.url,
              active.username,
              active.password,
              active.macAddress,
              active.serialNumber,
              active.deviceId1,
              active.deviceId2,
              active.signature1,
              active.signature2,
              active.userAgent,
              active.referrer,
              active.origin,
          ])
        : '';
    // Inside the meddl apps the provider is reached directly (built-in server).
    const local = localServerAvailable();
    const connectionKey = `${fingerprint}:${local ? 'local' : `${data.backend}:${data.backendToken}`}`;
    useEffect(() => {
        setReady(0);

        callbacks.current.reset();
        provider.current?.dispose();
        if (!storageReady || !active || (!local && !data.backend)) {
            setBusy(false);
            setWarm(IDLE);
            return;
        }
        const abort = new AbortController();
        const snapshot = { ...active };
        const client = new CachedProvider(createProvider(
            snapshot,
            local ? new LocalTransport() : new ProviderTransport(data.backend, data.backendToken),
            (source) =>
                callbacks.current.update((d) => ({
                    ...d,
                    sources: d.sources.map((s) =>
                        s.id === source.id && !abort.signal.aborted
                            ? {
                                  ...s,
                                  endpoint: source.endpoint,
                                  full: source.full,
                                  token: source.token,
                              }
                            : s
                    ),
                }))
        ));
        owner.current = connectionKey;
        provider.current = client;
        setBusy(true);
        setWarm({ phase: 'connecting', steps: [] });
        callbacks.current.report('');
        // "Only through the VPN": nothing reaches the provider before the tunnel is up.
        vpnReady(abort.signal, (vpnError) => {
            if (!abort.signal.aborted) setWarm({ phase: 'vpn', steps: [], vpnError });
        })
            .then(() => {
                if (!abort.signal.aborted) setWarm({ phase: 'connecting', steps: [] });
                return client.connect(abort.signal);
            })
            .then(() => {
                if (!abort.signal.aborted) {
                    callbacks.current.report('');
                    setReady(retry + 1);
                    // Load every section once while the loading window
                    // blocks the screen; tabs then open from memory.
                    setWarm({
                        phase: 'loading',
                        steps: client.warmKinds().map((kind) => ({ kind, state: 'waiting' })),
                    });
                    // Lists kept on this device open without the blocking
                    // window unless that takes long; a download shows it.
                    const stopOrigin = onListOrigin((origin) => {
                        if (origin === 'provider' && !abort.signal.aborted)
                            setWarm((current) => (current.phase === 'idle' || current.downloading ? current : { ...current, downloading: true }));
                    });
                    void client
                        .warm(data.catalogSort, (kind, state, total) => {
                            if (abort.signal.aborted) return;
                            setWarm((current) => ({
                                ...current,
                                steps: current.steps.map((step) =>
                                    step.kind === kind ? { kind, state, total } : step
                                ),
                            }));
                        })
                        .finally(() => {
                            stopOrigin();
                            if (!abort.signal.aborted) setWarm(IDLE);
                        });
                }
            })
            .catch(() => {
                if (!abort.signal.aborted) setWarm(IDLE);
                if (!abort.signal.aborted)
                    callbacks.current.report(
                        t('The request failed. Check your source and backend, then retry.')
                    );
            })
            .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
            });
        return () => {
            abort.abort();
            client.dispose();
        };
    }, [
        fingerprint,
        active?.m3uItems,
        data.backend,
        data.backendToken,
        storageReady,
        retry,
    ]);
    return {
        provider,
        ready: owner.current === connectionKey ? ready : 0,
        busy,
        warm: owner.current === connectionKey ? warm : IDLE,
        skipWarm: () => setWarm(IDLE),
        connectionKey,
        enabled: storageReady && !!active && (local || !!data.backend),
    };
}
