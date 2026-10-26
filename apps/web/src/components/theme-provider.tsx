'use client';

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'ledgerflow-theme';
const CHANGE_EVENT = 'ledgerflow-theme-change';
let memoryTheme: Theme | null = null;

function getThemeSnapshot(): Theme {
  if (typeof window === 'undefined') return 'light';
  if (memoryTheme) return memoryTheme;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getServerThemeSnapshot(): Theme {
  return 'light';
}

function subscribeTheme(callback: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      memoryTheme = null;
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  media.addEventListener('change', callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
    media.removeEventListener('change', callback);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    memoryTheme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The in-memory preference remains usable for this tab.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return <ThemeContext value={{ theme, toggleTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
