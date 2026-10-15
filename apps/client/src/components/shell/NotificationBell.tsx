'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { useNotifications } from '../../hooks/useNotifications';
import { useAuthStore } from '../../stores/useAuthStore';

import { NavIcon } from './NavIcon';

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// In-app notifications (US-01.05 / US-01.10): a bell with an unread badge that
// opens a popover list. Disclosure pattern - the button toggles the panel, Escape
// closes it and returns focus to the button, as does moving focus or clicking
// outside. Choosing an item marks it read and follows its link. The unread count
// is also announced through a polite live region.
export function NotificationBell() {
  const user = useAuthStore((state) => state.user);
  const { data, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];
  const badge = unread > 9 ? '9+' : String(unread);
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        // Keyboard focus left the whole widget (Tab past the last item).
        if (open && event.relatedTarget && !rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-pill bg-surface-green text-ink transition-colors hover:text-brand-primary"
      >
        <NavIcon name="bell" size={18} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="notification-badge"
            className="absolute -right-xxs -top-xxs flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-danger px-xxs text-eyebrow font-semibold text-white"
          >
            {badge}
          </span>
        )}
      </button>

      <span role="status" aria-live="polite" className="sr-only">
        {unread > 0 ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}` : 'No unread notifications'}
      </span>

      {open && (
        <section
          id={panelId}
          aria-labelledby={headingId}
          className="absolute right-0 z-30 mt-xs flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col rounded-md border border-border-soft bg-surface-1 shadow-card-strong"
        >
          <div className="flex items-center justify-between gap-sm border-b border-border-soft px-md py-sm">
            <h2 id={headingId} className="text-body font-semibold text-ink">
              Notifications
            </h2>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-caption font-semibold text-brand-primary hover:underline">
                Mark all as read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-md py-lg text-center text-body text-text-secondary">You&apos;re all caught up</p>
          ) : (
            <ul className="max-h-[24rem] overflow-y-auto py-xs">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      if (!item.read) markRead(item.id);
                      setOpen(false);
                    }}
                    className="flex items-start gap-sm px-md py-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-xs h-[8px] w-[8px] shrink-0 rounded-pill ${item.read ? 'bg-transparent' : 'bg-brand-primary'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-body text-ink ${item.read ? '' : 'font-semibold'}`}>
                        {item.title}
                        {!item.read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="block break-words text-caption text-text-secondary">{item.body}</span>
                      <span className="block text-eyebrow text-text-subtle">{formatWhen(item.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
