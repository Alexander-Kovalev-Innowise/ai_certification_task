'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

// WCAG 2.1 AA (spec §13) accessible dialog shell shared by every modal.
//
// Callers keep their own `isOpen` handling (`if (!isOpen) return null;`) and
// render <Modal> only while open, so mounting == opening and unmounting ==
// closing: focus moves into the dialog on mount and is handed back to the
// element that opened it on unmount.
//
// - role="dialog" + aria-modal + aria-labelledby (the heading's id)
// - initial focus: `initialFocusRef`, else the first focusable control, else
//   the dialog itself
// - Tab / Shift+Tab are trapped inside the dialog
// - Escape closes (topmost dialog only, when several are stacked)
// - clicking the backdrop closes (opt out with `closeOnBackdrop={false}`)
// - `dismissible={false}` disables both Escape and backdrop (e.g. in-flight)
// - page scroll is locked while at least one dialog is open

export interface ModalProps {
  /** Id of the heading element that names the dialog. */
  labelledBy: string;
  /** Optional id of an element holding the dialog's description. */
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
  /** Classes for the dialog panel (width, border, padding, ...). */
  className?: string;
  /** Element to focus first instead of the first focusable control. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** When false, Escape and backdrop clicks do nothing. Default true. */
  dismissible?: boolean;
  /** When false, only Escape closes (keeps half-typed forms safe). Default true. */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true' && !element.closest('[hidden]'),
  );
}

// Open dialogs, topmost last. Only the topmost reacts to Escape; the body
// scroll lock is released when the last one closes.
const openStack: symbol[] = [];
let previousBodyOverflow = '';

export function Modal({
  labelledBy,
  describedBy,
  onClose,
  children,
  className = '',
  initialFocusRef,
  dismissible = true,
  closeOnBackdrop = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const tokenRef = useRef<symbol>(Symbol('modal'));

  // Always call the latest callbacks without re-running the mount effects.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useLayoutEffect(() => {
    const token = tokenRef.current;
    const panel = panelRef.current;
    openerRef.current = document.activeElement;

    if (openStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openStack.push(token);

    const target = initialFocusRef?.current ?? (panel ? getFocusable(panel)[0] : undefined) ?? panel;
    target?.focus();

    return () => {
      const index = openStack.indexOf(token);
      if (index !== -1) openStack.splice(index, 1);
      if (openStack.length === 0) document.body.style.overflow = previousBodyOverflow;

      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
    // Mount/unmount only: initial focus must not be re-applied on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const token = tokenRef.current;

    function onKeyDown(event: KeyboardEvent) {
      if (openStack[openStack.length - 1] !== token) return;
      const panel = panelRef.current;
      if (!panel) return;

      if (event.key === 'Escape') {
        if (dismissibleRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && dismissible) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`max-h-full overflow-y-auto outline-none ${className}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}
