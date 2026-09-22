// @practiceperfect/eslint-config/next.mjs
// Extends base.mjs with eslint-plugin-react, eslint-plugin-react-hooks, @next/eslint-plugin-next.
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';

import base from './base.mjs';

export default tseslint.config(...base, {
  plugins: {
    react: reactPlugin,
    'react-hooks': reactHooksPlugin,
    '@next/next': nextPlugin,
  },
  rules: {
    ...reactPlugin.configs.recommended.rules,
    ...reactHooksPlugin.configs.recommended.rules,
    ...nextPlugin.configs.recommended.rules,
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
});
