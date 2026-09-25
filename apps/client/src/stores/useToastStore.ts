import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (variant: ToastVariant, message: string) => string;
  dismiss: (id: string) => void;
}

let nextId = 0;

// Task 18.3 — the client-only state `toast.ts` (the thin `toast.success/
// error/info` API) writes to and `ToastContainer.tsx` (mounted once at the
// root boundary) reads from. Zustand, not Context — fe §6.1's reasoning for
// every other genuinely-client-only piece of state in this app (auth token,
// active trainer context, impersonation countdown) applies identically here:
// a toast firing is exactly the kind of "form-in-progress UI state" fe §6.3
// names as Zustand's territory, not TanStack Query's.
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (variant, message) => {
    const id = `toast-${++nextId}`;
    set((state) => ({ toasts: [...state.toasts, { id, variant, message }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
