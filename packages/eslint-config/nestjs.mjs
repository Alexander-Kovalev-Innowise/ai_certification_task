// @practiceperfect/eslint-config/nestjs.mjs
// Extends base.mjs with NestJS/decorator-friendly rules.
import tseslint from 'typescript-eslint';

import base from './base.mjs';

export default tseslint.config(...base, {
  rules: {
    // @Module()/@Injectable() classes with no members are idiomatic Nest, not dead code.
    '@typescript-eslint/no-extraneous-class': 'off',
    // Decorator metadata relies on parameter properties (constructor(private readonly x: Y)).
    '@typescript-eslint/parameter-properties': 'off',
    // Nest decorators are frequently applied without an explicit return type on handlers.
    '@typescript-eslint/explicit-function-return-type': 'off',
    // TODO: custom rule enforcing @RequiresCapability (added in Task 9.1 once the decorator exists)
  },
});
