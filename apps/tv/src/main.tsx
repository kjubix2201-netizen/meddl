import { render } from 'preact';
import { TvApp } from '@meddl/tv/feature';
import './theme.css';
import './live-overlay.css';
import './programme-guide.css';
import './grid-guide.css';
import './redesign.css';
import './home.css';
import './glass.css';
const root = document.getElementById('app');
if (!root) throw new Error('Missing TV application root');
render(<TvApp />, root);

import './settings.css';
