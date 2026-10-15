// @practiceperfect/eslint-config/nestjs.mjs
// Extends base.mjs with NestJS/decorator-friendly rules.
import tseslint from 'typescript-eslint';

import base from './base.mjs';
import requireCapabilityDecorator from './rules/require-capability-decorator.mjs';

// Task 9.1: lint-time half of arch §9.2's boot-time assertion (Task 2.8,
// apps/server/src/shared/security/assert-routes-have-capability.ts).
const practiceperfectPlugin = {
  rules: {
    'require-capability-decorator': requireCapabilityDecorator,
  },
};

export default tseslint.config(
  ...base,
  {
    plugins: {
      practiceperfect: practiceperfectPlugin,
    },
    rules: {
      // @Module()/@Injectable() classes with no members are idiomatic Nest, not dead code.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Decorator metadata relies on parameter properties (constructor(private readonly x: Y)).
      '@typescript-eslint/parameter-properties': 'off',
      // Nest decorators are frequently applied without an explicit return type on handlers.
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // Scoped to real controllers only (module naming convention:
    // <name>.controller.ts). Deliberately excludes *.spec.ts/*.e2e-spec.ts —
    // several of those (e.g. app-module-boot.e2e-spec.ts,
    // auth-throttler.guard.spec.ts) declare throwaway/probe @Controller()
    // classes inline, including ones that are *intentionally* undecorated to
    // exercise the boot-time assertion's negative case. Those are test
    // fixtures, not shipped routes, so they're out of scope for this rule.
    files: ['**/*.controller.ts'],
    rules: {
      'practiceperfect/require-capability-decorator': 'error',
    },
  },
);
