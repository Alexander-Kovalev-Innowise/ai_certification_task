// Task 18.3/fe §9.4 — the "client error monitor" the spec names as the sink
// for signals that should never happen in steady state (a
// CHILD_CAPABILITY_DENIED/CHILD_FIELD_NOT_EDITABLE reaching the client
// anyway despite the UI hide-rules meant to prevent it, or an ErrorBoundary
// catch). No error-tracking vendor (Sentry/etc.) is wired into this app —
// this is a thin, swappable seam: every call site imports `logClientError`
// rather than calling `console.error` directly, so wiring a real vendor
// later is a one-file change, not a search-and-replace across call sites.
export function logClientError(context: string, detail: Record<string, unknown>): void {
  console.error(`[client-error-monitor] ${context}`, detail);
}
