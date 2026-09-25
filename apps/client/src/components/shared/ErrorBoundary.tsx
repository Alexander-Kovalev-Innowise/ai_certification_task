'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { logClientError } from '../../lib/monitoring/errorMonitor';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// fe §9.4/Task 18.3 — the generic "Something went wrong, please try again"
// boundary. React error boundaries must be class components (no hook
// equivalent exists) — this is the one place in the app that pattern is
// unavoidable. Catches any render-time exception as a last-resort safety
// net, not just `FatalApiError` (apiClient.ts's `500 TENANT_SCOPE_VIOLATION`
// signal, propagated here via TanStack Query's `throwOnError`, see
// QueryProvider.tsx) — a real, unexpected render bug degrades exactly the
// same way. Deliberately never explains *what* broke (api §0.5:
// TENANT_SCOPE_VIOLATION is "alerted, not user-facing copy").
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logClientError('error-boundary-caught', { message: error.message, componentStack: info.componentStack ?? undefined });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-screen w-full flex-col items-center justify-center gap-md bg-[var(--surface-0)] p-lg text-center"
        >
          <p className="text-body text-[var(--text-primary)]">Something went wrong. Please try again.</p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-sm border border-[var(--border-soft)] px-md py-xs text-body text-[var(--text-primary)] hover:border-[var(--brand-primary)]"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
