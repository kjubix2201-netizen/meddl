import { render } from 'preact';
import { PlayerOverlayView, TvApp } from '@meddl/tv/feature';
import './theme.css';
import './live-overlay.css';
import './programme-guide.css';
import './grid-guide.css';
import './redesign.css';
import './home.css';
import './glass.css';
import './countries.css';
import './loading.css';
import './player.css';
// Android TVs have small graphics chips: background blur ("glass") makes
// scrolling stutter there, so tv-lite.css switches it off.
try {
    const shell = (window as unknown as { MeddlAndroid?: { isTelevision?: () => boolean } }).MeddlAndroid;
    if (shell?.isTelevision?.()) document.documentElement.classList.add('tv-lite', 'tv-ui');
    // The Windows app shows the same TV interface and feel (no blur cut needed).
    if ((window as unknown as { meddlDesktop?: unknown }).meddlDesktop) document.documentElement.classList.add('tv-ui');
} catch {
    // Older app versions: keep the full look.
}
const root = document.getElementById('app');
if (!root) throw new Error('Missing TV application root');
// The Windows app's see-through player controls (player-overlay-window.ts).
if (new URLSearchParams(location.search).get('overlay') === 'player') {
    document.documentElement.classList.add('player-overlay-page');
    render(<PlayerOverlayView />, root);
} else {
    render(<TvApp />, root);
}

import './settings.css';
import './live-stage.css';
import './detail-compact.css';
import './phone.css';
import './tv-lite.css';
import './country-drawer.css';
