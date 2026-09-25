/**
 * Theme choice: System / Light / Dark, persisted in localStorage, default
 * System (spec/06). "System" follows `prefers-color-scheme`.
 */

import { KEYS, readString, writeString } from './persistence';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function loadTheme(): Theme {
  const raw = readString(KEYS.theme);
  return isTheme(raw) ? raw : 'system';
}

export function saveTheme(theme: Theme): void {
  writeString(KEYS.theme, theme);
}

/** Resolve to the concrete scheme actually rendered right now. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof matchMedia !== 'function') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset['theme'] = theme === 'system' ? '' : theme;
  if (theme === 'system') delete root.dataset['theme'];
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme;
}
