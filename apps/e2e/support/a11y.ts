import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export type Theme = 'dark' | 'light';

/** WCAG 2.1 AA rule sets axe is asked to evaluate (spec section 13). */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

/**
 * Makes the app boot in `theme` (the same localStorage key app/layout.tsx's
 * inline script reads) and with reduced motion, so framer-motion transitions
 * have settled and cannot skew colour sampling.
 */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('pp.theme', value);
    } catch {
      /* storage unavailable: the app falls back to dark */
    }
  }, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

export interface AxeOptions {
  /** CSS selector to restrict the scan to (e.g. an open dialog). */
  include?: string;
  /** Extra selectors axe must skip. */
  exclude?: string[];
}

/**
 * Runs axe (wcag2a + wcag2aa + wcag21aa) on the current page and asserts there
 * are no serious/critical violations. Moderate/minor ones are logged, not fatal.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string, options: AxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (options.include) builder = builder.include(options.include);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');

  const describe = (violations: typeof results.violations) =>
    violations
      .map(
        (violation) =>
          `[${violation.impact}] ${violation.id}: ${violation.help}\n` +
          violation.nodes
            .slice(0, 6)
            .map((node) => `    - ${node.target.join(' ')}\n      ${node.failureSummary?.replace(/\n/g, '\n      ')}`)
            .join('\n'),
      )
      .join('\n');

  const minor = results.violations.filter((violation) => !blocking.includes(violation));
  if (minor.length > 0) console.log(`[a11y] ${label}: non-blocking findings\n${describe(minor)}`);

  expect(blocking, `axe: ${label}\n${describe(blocking)}`).toEqual([]);
}

/**
 * `next dev` injects a focusable <nextjs-portal> (the "N" dev-tools badge) at the start of the tab order. It does not
 * exist in a production build, so drop it before a keyboard-only walk-through.
 */
export async function dropDevToolsPortal(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((node) => node.remove());
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

/**
 * Presses Tab (keyboard only - no mouse, no `.focus()`) until `target` has focus; returns how many presses it took.
 * Fails if it is not reached within `max` presses, i.e. the control is not in the keyboard tab order.
 */
export async function tabUntilFocused(page: Page, target: Locator, max = 80): Promise<number> {
  for (let presses = 1; presses <= max; presses += 1) {
    await page.keyboard.press('Tab');
    const focused = await target.evaluate((element) => element === document.activeElement).catch(() => false);
    if (focused) return presses;
  }
  throw new Error(`${String(target)} was not reached with ${max} Tab presses`);
}
