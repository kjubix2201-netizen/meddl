import {
    readServerStorageConfig,
    serverStorageConfigProblem,
} from './storage-config';

describe('readServerStorageConfig', () => {
    it('keeps storage off and the API open by default', () => {
        expect(readServerStorageConfig({})).toEqual({
            enabled: false,
            accessToken: null,
            maxDocumentBytes: 64 * 1024 * 1024,
        });
    });

    it('enables storage only for MEDDL_STORAGE=server', () => {
        expect(
            readServerStorageConfig({ MEDDL_STORAGE: ' Server ' }).enabled
        ).toBe(true);
        expect(
            readServerStorageConfig({ MEDDL_STORAGE: 'none' }).enabled
        ).toBe(false);
        expect(
            readServerStorageConfig({ MEDDL_STORAGE: '1' }).enabled
        ).toBe(false);
    });

    it('reads a trimmed access token and ignores a blank one', () => {
        expect(
            readServerStorageConfig({ MEDDL_ACCESS_TOKEN: ' s3cret ' })
                .accessToken
        ).toBe('s3cret');
        expect(
            readServerStorageConfig({ MEDDL_ACCESS_TOKEN: '  ' })
                .accessToken
        ).toBeNull();
    });

    it('reads a positive document limit in megabytes', () => {
        expect(
            readServerStorageConfig({ MEDDL_MAX_DOCUMENT_MB: '8' })
                .maxDocumentBytes
        ).toBe(8 * 1024 * 1024);
        expect(
            readServerStorageConfig({ MEDDL_MAX_DOCUMENT_MB: '-1' })
                .maxDocumentBytes
        ).toBe(64 * 1024 * 1024);
    });

    it('refuses an access token without server storage', () => {
        const problem = (env: Record<string, string>) =>
            serverStorageConfigProblem(readServerStorageConfig(env));

        expect(problem({ MEDDL_ACCESS_TOKEN: 's3cret' })).toContain(
            'MEDDL_STORAGE=server'
        );
        expect(
            problem({
                MEDDL_ACCESS_TOKEN: 's3cret',
                MEDDL_STORAGE: 'server',
            })
        ).toBeNull();
        expect(problem({})).toBeNull();
    });
});
