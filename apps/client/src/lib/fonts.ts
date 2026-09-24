import localFont from 'next/font/local';

// fe §1.1 — Clash Display, self-hosted via next/font/local (no runtime
// dependency on a font CDN — matters for the @Public() /join/[code] and
// /login routes, which must render fast and be offline-tolerant of
// third-party blocking). Only the Bold (700) weight is shipped: per
// DESIGN_TOKENS.md's scale, hero-title/section-title/block-title — the only
// three tokens that use this family — are all weight 700; no other weight
// of Clash Display is referenced anywhere in the design.
export const clashDisplay = localFont({
  src: '../assets/fonts/clash-display/ClashDisplay-Bold.woff2',
  weight: '700',
  style: 'normal',
  display: 'swap',
  variable: '--font-clash-display',
  fallback: ['Archivo Black', 'sans-serif'],
});

// fe §1.1 — General Sans, self-hosted. Regular (400) covers body-lg/body/
// caption, Semibold (600) covers card-title/eyebrow — the two weights named
// in the type scale. Medium (500) ships alongside for interactive/hover text
// states that aren't yet pinned to a named token.
export const generalSans = localFont({
  src: [
    { path: '../assets/fonts/general-sans/GeneralSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/general-sans/GeneralSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/general-sans/GeneralSans-Semibold.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-general-sans',
  fallback: ['Segoe UI', 'sans-serif'],
});
