import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'pp.theme';

function read(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// The <html data-theme> attribute IS the source of truth (the inline script in
// app/layout.tsx sets it before first paint), so every consumer just observes it.
function subscribe(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'dark' as Theme);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next: Theme = read() === 'light' ? 'dark' : 'light';
    // Cross-fade colours for a moment instead of snapping (see globals.css).
    root.classList.add('theme-transition');
    root.dataset.theme = next;
    window.setTimeout(() => root.classList.remove('theme-transition'), 450);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page view.
    }
  }, []);

  return [theme, toggle];
}
