import type { HTMLAttributes, ReactNode } from 'react';

// Solid, opaque content card: small radius, hairline border, soft shadow.
// Compose with CardHeader / CardSection / CardFooter. Colors are theme tokens
// only so the light/dark switch restyles it for free.
export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = '', children, ...props }: CardProps) {
  return (
    <div
      className={`w-full rounded-[14px] border border-border-soft bg-surface-1 p-lg shadow-card-soft ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  /** Heading content; rendered as an h1 unless `titleAs` says otherwise. */
  title: ReactNode;
  /** Heading level for the title. Use `h2` when the page already has its own h1. */
  titleAs?: 'h1' | 'h2' | 'h3';
  subtitle?: ReactNode;
  /** Badge(s) shown beside the title. */
  badge?: ReactNode;
  className?: string;
}

export function CardHeader({ title, titleAs: Title = 'h1', subtitle, badge, className = '' }: CardHeaderProps) {
  return (
    <header className={`flex flex-col gap-xxs pb-lg ${className}`}>
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
        <Title className="min-w-0 break-words text-xl font-semibold text-ink">{title}</Title>
        {badge && <div className="flex flex-wrap items-center gap-xs">{badge}</div>}
      </div>
      {subtitle && <p className="break-words text-body text-ink-muted">{subtitle}</p>}
    </header>
  );
}

export interface CardSectionProps {
  /** Small uppercase eyebrow heading. */
  heading: string;
  children: ReactNode;
  className?: string;
}

export function CardSection({ heading, children, className = '' }: CardSectionProps) {
  const headingId = `card-section-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-md border-t border-border-soft py-lg ${className}`}>
      <h2 id={headingId} className="text-caption font-semibold uppercase tracking-wider text-text-subtle">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

export function CardFooter({ className = '', children, ...props }: CardFooterProps) {
  return (
    <div
      data-slot="card-footer"
      className={`flex flex-col gap-sm border-t border-border-soft pt-lg sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
