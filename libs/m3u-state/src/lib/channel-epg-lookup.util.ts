import { Channel } from '@meddl/shared/interfaces';

export function resolveChannelEpgLookupKey(
    channel: Channel | null | undefined
): string {
    return (
        channel?.tvg?.id?.trim() ||
        channel?.tvg?.name?.trim() ||
        channel?.name?.trim() ||
        ''
    );
}
