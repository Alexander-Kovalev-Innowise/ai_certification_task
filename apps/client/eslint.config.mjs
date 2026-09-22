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
  },
];
