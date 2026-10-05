'use client';

import { useEffect, useRef, useState } from 'react';

import { ActionIconButton } from '../shared/ActionIcon';

export interface RevokeConfirmPopoverProps {
  onConfirm: () => void;
  disabled?: boolean;
  /**
   * `'button'` (default) renders the text "Revoke" button; `'icon'` renders a
   * trash ActionIcon (labelled "Revoke") for use in a table's actions column.
   */
  variant?: 'button' | 'icon';
}

// fe §4.4/§9.4 — RevokeConfirmPopover: revoke (`DELETE /share-links/:id`) is
// low-stakes and easily-reversible-in-effect (generating a fresh link costs
// nothing), so unlike the Super Admin's GDPR-delete/deactivate modals this
// is a small inline popover, not a full blocking dialog — and the actual
// mutation is **optimistic** at the call site (`/share-links` page: row
// fades immediately, rolls back on failure), not gated on this component.
// Task 13.3.
export function RevokeConfirmPopover({ onConfirm, disabled = false, variant = 'button' }: RevokeConfirmPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Table wrappers scroll/clip (overflow-x-auto), so an absolutely positioned
  // popover would be cut off on the last rows. In the icon variant the
  // popover is `fixed`, anchored to the trigger's viewport rect, and closes
  // on scroll/resize rather than drifting away from its trigger.
  useEffect(() => {
    if (!isOpen || variant !== 'icon') return;
    const close = () => setIsOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen, variant]);

  function handleOpen() {
    const rect = triggerRef.current?.getBoundingClientRect();
    setAnchor(rect ? { top: rect.bottom + 4, right: Math.max(0, window.innerWidth - rect.right) } : null);
    setIsOpen(true);
  }

  function handleConfirm() {
    setIsOpen(false);
    onConfirm();
  }

  return (
    <span className="relative inline-block">
      {variant === 'icon' ? (
        <ActionIconButton ref={triggerRef} icon="trash" label="Revoke" tone="danger" disabled={disabled} onClick={handleOpen} />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={handleOpen}
          className="btn btn-secondary btn-danger-outline btn-sm"
        >
          Revoke
        </button>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Confirm revoke"
          style={variant === 'icon' && anchor ? { position: 'fixed', top: anchor.top, right: anchor.right } : undefined}
          className={`${variant === 'icon' && anchor ? '' : 'absolute right-0 mt-xxs'} z-30 w-56 rounded-md border border-border-soft bg-surface-1 p-sm text-left shadow-card-strong`}
        >
          <p className="text-caption text-text-primary">Revoke this share link? It will stop working immediately.</p>
          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={() => setIsOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="btn btn-danger btn-sm"
            >
              Yes, revoke
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
