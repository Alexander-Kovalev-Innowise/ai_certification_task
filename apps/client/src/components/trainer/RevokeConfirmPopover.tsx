'use client';

import { useState } from 'react';

export interface RevokeConfirmPopoverProps {
  onConfirm: () => void;
  disabled?: boolean;
}

// fe §4.4/§9.4 — RevokeConfirmPopover: revoke (`DELETE /share-links/:id`) is
// low-stakes and easily-reversible-in-effect (generating a fresh link costs
// nothing), so unlike the Super Admin's GDPR-delete/deactivate modals this
// is a small inline popover, not a full blocking dialog — and the actual
// mutation is **optimistic** at the call site (`/share-links` page: row
// fades immediately, rolls back on failure), not gated on this component.
// Task 13.3.
export function RevokeConfirmPopover({ onConfirm, disabled = false }: RevokeConfirmPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  function handleConfirm() {
    setIsOpen(false);
    onConfirm();
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        className="rounded-sm border border-[var(--border-soft)] p-xxs text-caption text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-60"
      >
        Revoke
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Confirm revoke"
          className="absolute right-0 z-10 mt-xxs w-56 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm shadow-card-strong"
        >
          <p className="text-caption text-[var(--text-primary)]">Revoke this share link? It will stop working immediately.</p>
          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={() => setIsOpen(false)} className="rounded-sm p-xxs text-caption text-[var(--text-secondary)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-sm bg-[var(--danger)] p-xxs text-caption font-semibold text-white"
            >
              Yes, revoke
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
