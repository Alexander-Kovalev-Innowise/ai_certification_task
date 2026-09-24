import type { Config } from 'tailwindcss';

// Extends theme.spacing/borderRadius/boxShadow/fontSize from the token tables
// in Task/designs/DESIGN_TOKENS.md and specs/frontend-design-spec.md §1.2/1.3.
// Do not invent new scale values here — every value below maps 1:1 to a
// documented token. Font loading (actual font files) is Task 10.1.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // fe §1.1 — CSS vars injected by next/font/local (src/lib/fonts.ts)
        // via the `variable` option, applied to <html> in app/layout.tsx.
        // `sans` is the default body/UI voice (General Sans); `display` is
        // opt-in per component for hero-title/section-title/block-title.
        sans: ['var(--font-general-sans)', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-clash-display)', 'Archivo Black', 'sans-serif'],
      },
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        xxl: '40px',
      },
      borderRadius: {
        xs: '6px',
        sm: '10px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        pill: '999px',
      },
      boxShadow: {
        'card-soft': '0 2px 8px rgba(0, 0, 0, 0.2)',
        'card-strong': '0 4px 16px rgba(0, 0, 0, 0.3)',
        'button-primary': '0 10px 30px rgba(var(--brand-primary-rgb), 0.55)',
        'button-primary-hover': '0 12px 34px rgba(var(--brand-primary-rgb), 0.7)',
      },
      fontSize: {
        // [fontSize, { lineHeight }] — weight is applied via font-weight utilities
        // per component (DESIGN_TOKENS.md's typography scale).
        'hero-title': ['30px', { lineHeight: '38px' }],
        'section-title': ['22px', { lineHeight: '28px' }],
        'block-title': ['18px', { lineHeight: '24px' }],
        'card-title': ['16px', { lineHeight: '22px' }],
        'body-lg': ['16px', { lineHeight: '26px' }],
        body: ['14px', { lineHeight: '22px' }],
        caption: ['12px', { lineHeight: '18px' }],
        eyebrow: ['11px', { lineHeight: '16px' }],
      },
    },
  },
};

export default config;
