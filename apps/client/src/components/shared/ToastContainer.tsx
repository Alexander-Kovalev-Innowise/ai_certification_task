'use client';

import { useToastStore, type ToastVariant } from '../../stores/useToastStore';

const VARIANT_STYLE: Record<ToastVariant, string> = {
  success: 'border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]',
  error: 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]',
  info: 'border-[var(--info)]/40 bg-[var(--info)]/10 text-[var(--info)]',
};

// Task 18.3 — the single reader of `useToastStore`, mounted once at the root
// boundary (BootSequence.tsx, alongside ImpersonationBanner/
// EmailVerifiedBanner). Fixed, non-blocking (never a modal, per fe §9.4's
// framing for cross-cutting states in general) — stacks bottom-right so it
// never collides with ImpersonationBanner's top bar or EmailVerifiedBanner's
// banner slot. `error` toasts are `role="alert"` (assertive — matches every
// existing inline error message's semantics elsewhere in this app);
// `success`/`info` are `role="status"` (polite), same distinction
// EmailVerifiedBanner/ChangePasswordForm already make.
export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div aria-label="Notifications" className="fixed bottom-lg right-lg z-50 flex w-full max-w-sm flex-col gap-sm">
      {toasts.map((item) => (
        <div
          key={item.id}
          role={item.variant === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-md rounded-md border p-sm text-body shadow-card-soft ${VARIANT_STYLE[item.variant]}`}
        >
          <span>{item.message}</span>
          <button type="button" onClick={() => dismiss(item.id)} aria-label="Dismiss notification" className="opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
