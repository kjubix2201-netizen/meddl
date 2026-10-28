import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
    buildElectronLaunchEnvironment,
    ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
} from '../electron-test-fixtures';
import { assertXtreamBenchmarkEnvironmentIsolated } from './xtream-benchmark-iteration-support';

describe('Electron launch environment isolation', () => {
    it('makes post-spawn fixture preparation exception-safe', () => {
        const fixture = readFileSync(
            resolve(process.cwd(), 'src/electron-test-fixtures.ts'),
            'utf8'
        );
        const launch = fixture.indexOf(
            'const electronApp = await electron.launch'
        );
        const guardedPreparation = fixture.indexOf(
            'return prepareElectronApplication',
            launch
        );
        const strictDisposal = fixture.indexOf(
            'closeElectronApplicationAndConfirmExit',
            guardedPreparation
        );
        const mainWindow = fixture.indexOf(
            'const mainWindow = await findMainWindow',
            guardedPreparation
        );

        assert.ok(launch >= 0);
        assert.ok(guardedPreparation > launch);
        assert.ok(strictDisposal > guardedPreparation);
        assert.ok(mainWindow > strictDisposal);
    });

    it('inherits only portable runtime keys for a profiled benchmark child', () => {
        const environment = buildElectronLaunchEnvironment(
            '/tmp/meddl-performance',
            {
                environmentInheritance: 'runtime-only',
                env: {
                    MEDDL_PERF_CAPTURE: '1',
                },
            },
            {
                AWS_SECRET_ACCESS_KEY: 'aws-secret',
                ELECTRON_RUN_AS_NODE: '1',
                GITHUB_TOKEN: 'github-secret',
                HTTPS_PROXY: 'https://user:password@proxy.invalid',
                MEDDL_ALLOW_PRIVATE_NETWORK_URLS: '0',
                MEDDL_REAL_PROVIDER_URL: 'https://provider.invalid',
                MEDDL_XTREAM_MOCK_CONTROL: '1',
                MEDDL_XTREAM_MOCK_CONTROL_TOKEN: 'secret-token',
                NODE_OPTIONS: '--require credential-dumper.js',
                PATH: '/usr/bin',
                REAL_PROVIDER_PASSWORD: 'provider-password',
                REAL_PROVIDER_URL: 'https://provider.invalid',
                TMPDIR: '/tmp/runtime',
            }
        );

        assert.equal(environment['MEDDL_PERF_CAPTURE'], '1');
        assert.equal(environment['MEDDL_ALLOW_PRIVATE_NETWORK_URLS'], '1');
        assert.equal(environment['PATH'], '/usr/bin');
        assert.equal(environment['TMPDIR'], '/tmp/runtime');
        for (const key of [
            'AWS_SECRET_ACCESS_KEY',
            'ELECTRON_RUN_AS_NODE',
            'GITHUB_TOKEN',
            'HTTPS_PROXY',
            'MEDDL_REAL_PROVIDER_URL',
            'MEDDL_XTREAM_MOCK_CONTROL',
            'MEDDL_XTREAM_MOCK_CONTROL_TOKEN',
            'NODE_OPTIONS',
            'REAL_PROVIDER_PASSWORD',
            'REAL_PROVIDER_URL',
        ]) {
            assert.equal(environment[key], undefined, key);
        }
    });

    it('drops undefined overrides instead of serializing them into the child', () => {
        const environment = buildElectronLaunchEnvironment(
            '/tmp/meddl-performance',
            { env: { OPTIONAL_DEBUG_FLAG: undefined } },
            { OPTIONAL_DEBUG_FLAG: 'inherited' }
        );

        assert.equal(environment['OPTIONAL_DEBUG_FLAG'], undefined);
    });

    it('checks the effective Electron main environment, not only launch input', async () => {
        const allowed = [
            ...ELECTRON_RUNTIME_ENVIRONMENT_KEYS,
            'ELECTRON_IS_DEV',
            'MEDDL_ALLOW_PRIVATE_NETWORK_URLS',
            'MEDDL_DB_WORKER_BATCH_DELAY_MS',
            'MEDDL_E2E_DATA_DIR',
            'MEDDL_PERF_CAPTURE',
            'MEDDL_PERF_WORKER_PROFILING',
            'MEDDL_TRACE_RENDERER_CONSOLE',
            'NODE_ENV',
        ];

        await assert.doesNotReject(
            assertXtreamBenchmarkEnvironmentIsolated(fakeApp(allowed))
        );
        for (const leaked of [
            'GITHUB_TOKEN',
            'HTTPS_PROXY',
            'NODE_OPTIONS',
            'REAL_PROVIDER_URL',
        ]) {
            await assert.rejects(
                assertXtreamBenchmarkEnvironmentIsolated(
                    fakeApp([...allowed, leaked])
                ),
                /xtream-benchmark-environment-reached-electron/
            );
        }
    });
});

function fakeApp(keys: readonly string[]) {
    return {
        electronApp: {
            evaluate: async () => [...keys],
        },
    } as never;
}
