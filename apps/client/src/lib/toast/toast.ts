import { useToastStore } from '../../stores/useToastStore';

export const AUTO_DISMISS_MS = 5_000;

function show(variant: 'success' | 'error' | 'info', message: string): string {
  const id = useToastStore.getState().push(variant, message);
  if (typeof window !== 'undefined') {
    window.setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS);
  }
  return id;
}

/**
 * Task 18.3 — this codebase's toast primitive, resolving the "no toast
 * library exists" stopgap every prior frontend phase (11-17) explicitly
 * flagged in its own comments. Deliberately hand-rolled rather than a
 * dependency: the app needs exactly three call shapes
 * (success/error/info, single-line message, auto-dismiss), the same
 * "small, auditable, no new dependency" reasoning Phase 12 already applied
 * to virtualization. `ToastContainer.tsx` (mounted once at the root
 * boundary, same as `ImpersonationBanner`/`EmailVerifiedBanner`) is the only
 * reader of the underlying `useToastStore` — every other call site just
 * calls `toast.success(...)`/`toast.error(...)`/`toast.info(...)`, the same
 * "one central place" shape `apiClient.ts`'s `apiRequest` already
 * established for this app's other cross-cutting concerns.
 *
 * Scope boundary (see the Phase 18 wrap-up report): this task does NOT
 * retrofit Phases 11-17's existing inline `role="alert"`/`role="status"`
 * usages to call through here — that is out-of-scope, unplanned surface.
 * This primitive is available for Task 18.3's own new cross-cutting wiring
 * (apiClient.ts's CHILD_CAPABILITY_DENIED/CHILD_FIELD_NOT_EDITABLE fallback)
 * and any other NEW code this phase writes.
 */
export const toast = {
  success: (message: string) => show('success', message),
  error: (message: string) => show('error', message),
  info: (message: string) => show('info', message),
};
