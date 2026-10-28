import { Channel } from '@meddl/shared/interfaces';
import { initialPlaylistMetaState, PlaylistMetaState } from './playlists.state';

import { EpgProgram } from '@meddl/shared/interfaces';

export interface PlaylistState {
    active: Channel | undefined;
    activePlaybackUrl: string | null;
    activeEpgProgram: EpgProgram | undefined;
    currentEpgProgram: EpgProgram | undefined;
    epgAvailable: boolean;
    channelsLoading: boolean;
    channels: Channel[]; // TODO: use entity store
    playlists: PlaylistMetaState;
}

export const initialState: PlaylistState = {
    active: undefined,
    activePlaybackUrl: null,
    activeEpgProgram: undefined,
    currentEpgProgram: undefined,
    epgAvailable: false,
    channelsLoading: false,
    channels: [],
    playlists: initialPlaylistMetaState,
};
