import { ChannelActions } from '@meddl/m3u-state';
import { Channel } from '@meddl/shared/interfaces';

export function createM3uChannelPlaybackRequest(channel: Channel) {
    return ChannelActions.setActiveChannel({
        channel,
        startPlayback: true,
    });
}
