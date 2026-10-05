'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { create } from 'zustand';

import { faviconHref, formatDocumentTitle, resolvePageMeta, type PageMeta } from '../lib/pageMeta';

interface PageMetaOverrideState {
  override: Partial<PageMeta> | null;
  setOverride: (override: Partial<PageMeta> | null) => void;
}

const usePageMetaOverrideStore = create<PageMetaOverrideState>((set) => ({
  override: null,
  setOverride: (override) => set({ override }),
}));

/**
 * Edit the current page's tab title and/or icon from inside the page, on top
 * of its default from `lib/pageMeta.ts` - e.g. `usePageMeta({ title: user.name })`.
 * The override is dropped when the page unmounts.
 */
export function usePageMeta(override: Partial<PageMeta>): void {
  const { title, icon } = override;
  const setOverride = usePageMetaOverrideStore((state) => state.setOverride);

  useEffect(() => {
    setOverride({ title, icon });
    return () => setOverride(null);
  }, [title, icon, setOverride]);
}

function applyIcon(href: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[data-page-icon]');
  if (!link) {
    document.head.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.setAttribute('data-page-icon', '');
    document.head.appendChild(link);
  }
  link.href = href;
}

/** Mounted once in the root layout: writes document.title and the tab icon for every route. */
export function PageMetaController(): null {
  const pathname = usePathname();
  const override = usePageMetaOverrideStore((state) => state.override);

  const base = resolvePageMeta(pathname ?? '/');
  const title = override?.title ?? base.title;
  const icon = override?.icon ?? base.icon;

  useEffect(() => {
    document.title = formatDocumentTitle(title);
    applyIcon(faviconHref(icon));
  }, [title, icon]);

  return null;
}
