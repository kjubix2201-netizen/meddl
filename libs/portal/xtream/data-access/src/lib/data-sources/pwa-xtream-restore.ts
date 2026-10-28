import type { UserDataStorage } from '@meddl/services';
import { PwaXtreamBackupStorage } from '@meddl/services/pwa-xtream-backup-storage';
import type { XtreamPendingRestoreState } from '@meddl/shared/interfaces';

/** Load backup persistence only for a restore, sharing the initial import contract. */
export function restorePwaXtreamUserData(
    storage: UserDataStorage,
    playlistId: string,
    state: XtreamPendingRestoreState
): Promise<void> {
    return new PwaXtreamBackupStorage(storage).restore(playlistId, state);
}
