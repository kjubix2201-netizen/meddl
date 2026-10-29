/**
 * Settings → "iPhone & phones" of the desktop TV interface: turns sharing
 * meddl in the home network on and off and reports the addresses to open.
 */
import { ipcMain } from 'electron';
import { homeNetworkServer } from '../services/home-network-server';
import { pairingServer } from '../services/pairing-server';
import { HOME_NETWORK_SHARING, store } from '../services/store.service';

export const HOME_NETWORK_STATUS = 'meddl:home-network-status';
export const HOME_NETWORK_SET = 'meddl:home-network-set';
export const PAIRING_START = 'meddl:pairing-start';

export function registerHomeNetworkHandlers(): void {
    ipcMain.handle(HOME_NETWORK_STATUS, () => homeNetworkServer.status());
    ipcMain.handle(HOME_NETWORK_SET, async (_event, enabled: unknown) => {
        const on = enabled === true;
        store.set(HOME_NETWORK_SHARING, on);
        return on ? homeNetworkServer.start() : homeNetworkServer.stop();
    });
    // Phone setup by QR code (Add from phone): started when first used.
    ipcMain.handle(PAIRING_START, () => pairingServer.start());
    if (store.get(HOME_NETWORK_SHARING, false) === true) void homeNetworkServer.start();
}
