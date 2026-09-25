import { render } from 'preact';
import { App } from './App';
import { applyTheme, loadTheme } from './state/theme';
import './styles.css';

// Apply the stored theme before the first paint so there is no flash.
applyTheme(loadTheme());

const root = document.getElementById('app');
if (root) render(<App />, root);
