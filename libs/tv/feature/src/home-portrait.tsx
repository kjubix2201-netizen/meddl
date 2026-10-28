import { useState } from 'preact/hooks';
import { TvIcon } from '@meddl/tv/ui';

/**
 * Optional personal picture for Home. Each install may drop a cut-out PNG at
 * `local/profile.png` (apps/tv/public/local/, ignored by git, so it never
 * ships with the product). Without the file Home stays neutral.
 */
export const PROFILE_PICTURE = 'local/profile.png';

/** Large dimmed portrait on the right of Home, behind clock and tiles. */
export function HomePortrait() {
    const [shown, setShown] = useState(false);
    return (
        <div class="home-portrait" aria-hidden="true" hidden={!shown}>
            <img
                src={PROFILE_PICTURE}
                alt=""
                onLoad={() => setShown(true)}
                onError={() => setShown(false)}
            />
        </div>
    );
}

/** Profile button face: the picture when present, otherwise a user glyph. */
export function ProfileFace() {
    const [failed, setFailed] = useState(false);
    if (failed) return <TvIcon name="user" />;
    return (
        <img
            class="profile-face"
            src={PROFILE_PICTURE}
            alt=""
            onError={() => setFailed(true)}
        />
    );
}
