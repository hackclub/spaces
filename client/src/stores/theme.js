import { writable } from 'svelte/store';
import { themes, defaultTheme } from '../themes.js';

const getInitialTheme = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme');
    return saved && themes[saved] ? saved : defaultTheme;
  }
  return defaultTheme;
};

export const currentTheme = writable(getInitialTheme());

export const setTheme = (themeName) => {
  if (themes[themeName]) {
    currentTheme.set(themeName);
    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', themeName);
      applyTheme(themeName);
    }
  }
};

export const applyTheme = (themeName) => {
  const theme = themes[themeName];
  if (theme && typeof document !== 'undefined') {
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    root.setAttribute('data-theme', themeName);
  }
};

if (typeof window !== 'undefined') {
  applyTheme(getInitialTheme());
}
