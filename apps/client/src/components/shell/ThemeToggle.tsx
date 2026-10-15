'use client';

import { NavIcon } from './NavIcon';
import { useTheme } from './useTheme';

// Round dark/light switch next to the user pill. Both glyphs are stacked and
// cross-fade with a rotate+scale, so the swap animates in both directions.
export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const isLight = theme === 'light';
  const label = isLight ? 'Switch to dark theme' : 'Switch to light theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-green text-ink transition-colors hover:text-brand-primary"
    >
      <span
        className={`absolute flex motion-safe:transition-all motion-safe:duration-300 ${
          isLight ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
        }`}
      >
        <NavIcon name="moon" size={18} />
      </span>
      <span
        className={`absolute flex motion-safe:transition-all motion-safe:duration-300 ${
          isLight ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
        }`}
      >
        <NavIcon name="sun" size={18} />
      </span>
    </button>
  );
}
