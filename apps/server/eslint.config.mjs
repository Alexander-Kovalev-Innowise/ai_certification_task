import nestConfig from '@practiceperfect/eslint-config/nestjs.mjs';

export default [
  ...nestConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
