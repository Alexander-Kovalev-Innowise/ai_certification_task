import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'pp.sidebar.collapsed';
const listeners = new Set<() => void>();
let current: boolean | null = null;

function read(): boolean {
  if (current === null) {
    try {
      current = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      current = false;
    }
  }
  return current;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      current = event.newValue === '1';
      listener();
    }
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

// Persisted per browser. Every AppShell instance (role layouts and the
// dashboard each mount their own) reads the same value, so the sidebar keeps
// its state while moving between them.
export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  const toggle = useCallback(() => {
    current = !read();
    try {
      window.localStorage.setItem(STORAGE_KEY, current ? '1' : '0');
    } catch {
      // Storage blocked: the state still lives in memory for this session.
    }
    notify();
  }, []);

  return [collapsed, toggle];
}
