import type { HTMLAttributes, ReactNode } from 'react';

// Single page wrapper for every authenticated route (content, loading and
// error states alike) so the title row sits at the same y everywhere and
// nothing shifts when data arrives: shell header bottom + 24px (`p-lg`),
// then the 40px PageHeader row, then `gap-lg`.
export type PageLayoutProps = HTMLAttributes<HTMLElement>;

export function PageLayout({ className = '', children, ...props }: PageLayoutProps) {
  return (
    <section className={`flex flex-1 flex-col gap-lg p-lg ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Id for the h1, for `aria-labelledby` wiring. */
  titleId?: string;
  subtitle?: ReactNode;
  /** Primary page actions (Create / Invite / ...), right-aligned. */
  actions?: ReactNode;
}

// The 40px row equals the standard button height, so the h1 is vertically
// centered in the same 40px slot whether or not there are actions. The subtitle
// hangs below that slot, letting the header grow downward without moving the
// title.
export function PageHeader({ title, titleId, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex min-h-[40px] items-start justify-between gap-md">
      <div className="min-w-0">
        <div className="flex min-h-[40px] items-center">
          <h1 className="truncate text-xl font-semibold leading-7 text-ink" id={titleId}>
            {title}
          </h1>
        </div>
        {subtitle && <p className="text-body text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-h-[40px] shrink-0 items-center gap-sm">{actions}</div>}
    </header>
  );
}

// Stand-in for the header row while a page's title is not yet known (e.g. it
// is the loaded entity's name), so the content below doesn't shift on arrival.
export function PageHeaderPlaceholder() {
  return <div aria-hidden="true" className="h-[40px]" />;
}
