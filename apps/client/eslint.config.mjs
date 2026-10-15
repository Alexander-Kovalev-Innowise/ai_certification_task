import nextConfig from '@practiceperfect/eslint-config/next.mjs';

export default [
  ...nextConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // @next/eslint-plugin-next's rules (no-html-link-for-pages among them)
    // need to know where the Next.js app root actually is — without this,
    // in a monorepo where `app/` isn't at the ESLint config's own root, the
    // plugin can't resolve valid routes and rules like no-html-link-for-pages
    // silently no-op instead of erroring. This was the reason plain <a href>
    // internal-navigation links (which cause a full page reload instead of
    // a fast client-side transition, and were the root cause of a real bug —
    // in-memory auth state getting wiped on every nav click) went undetected
    // by lint across ~8 files/89-touched-file's worth of changes.
    settings: {
      next: {
        rootDir: import.meta.dirname,
      },
    },
  },
];
