import type { Locator, Page } from '@playwright/test';

/**
 * Shows a small caption overlay at the bottom of the page for `ms` milliseconds
 * so the recorded video explains what is being tested. Safe to call repeatedly;
 * it never intercepts pointer events. Failures (e.g. mid-navigation) are swallowed:
 * a caption must never fail a test.
 */
export async function narrate(page: Page, text: string, ms = 1200): Promise<void> {
  try {
    await page.evaluate((caption) => {
      const id = '__e2e_caption__';
      document.getElementById(id)?.remove();
      const el = document.createElement('div');
      el.id = id;
      el.textContent = caption;
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        maxWidth: '80vw',
        padding: '10px 18px',
        borderRadius: '10px',
        background: 'rgba(15,15,15,0.92)',
        color: '#fff',
        font: '600 16px/1.3 system-ui, sans-serif',
        boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        border: '1px solid rgba(0,179,0,0.7)',
        pointerEvents: 'none',
        textAlign: 'center',
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(el);
    }, text);
    await page.waitForTimeout(ms);
    await page.evaluate(() => document.getElementById('__e2e_caption__')?.remove());
  } catch {
    /* never fail a test because of a caption */
  }
}

/** Draws a temporary bright outline around `target` (for ~`ms`) so viewers see what is being asserted/clicked. */
export async function highlight(target: Locator, ms = 700): Promise<void> {
  try {
    await target.first().evaluate((el) => {
      const node = el as HTMLElement;
      node.dataset.e2ePrevOutline = node.style.outline;
      node.dataset.e2ePrevOffset = node.style.outlineOffset;
      node.style.outline = '3px solid #ff3b81';
      node.style.outlineOffset = '3px';
    });
    await target.page().waitForTimeout(ms);
    await target.first().evaluate((el) => {
      const node = el as HTMLElement;
      node.style.outline = node.dataset.e2ePrevOutline ?? '';
      node.style.outlineOffset = node.dataset.e2ePrevOffset ?? '';
      delete node.dataset.e2ePrevOutline;
      delete node.dataset.e2ePrevOffset;
    });
  } catch {
    /* element gone (e.g. navigated away): ignore */
  }
}
