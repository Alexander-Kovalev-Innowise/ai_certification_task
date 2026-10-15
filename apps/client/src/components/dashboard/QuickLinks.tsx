import Link from 'next/link';

import { NavIcon, type NavIconName } from '../shell/NavIcon';

export interface QuickLinkItem {
  href: string;
  title: string;
  description: string;
  icon: NavIconName;
}

// A horizontal row of equal-height link cards (icon tile + title + one-line
// description + chevron). Wraps responsively via auto-fit; every card is one
// `<Link>` so the whole surface is clickable and keyboard-focusable.
export function QuickLinks({ links }: { links: readonly QuickLinkItem[] }) {
  return (
    <section aria-labelledby="quick-links-heading" className="flex flex-col gap-sm">
      <h2 id="quick-links-heading" className="text-caption font-semibold uppercase tracking-wider text-text-subtle">
        Quick links
      </h2>
      <nav aria-label="Quick links" className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] items-stretch gap-md">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex h-full items-center gap-md rounded-md border border-border-soft bg-surface-1 p-md shadow-card-soft transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-primary/15 text-brand-primary"
            >
              <NavIcon name={link.icon} size={20} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-lg font-semibold text-ink">{link.title}</span>
              <span className="text-caption text-ink-muted">{link.description}</span>
            </span>
            <span
              aria-hidden="true"
              className="text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand-primary motion-reduce:transition-none"
            >
              <NavIcon name="chevron-right" size={18} />
            </span>
          </Link>
        ))}
      </nav>
    </section>
  );
}
