// Task 9.1 — unit test for the require-capability-decorator rule using
// ESLint's own RuleTester (wired to Node's built-in test runner, since this
// package has no Jest of its own). Mirrors the fixtures used by
// apps/server/test/app-module-boot.e2e-spec.ts's boot-time assertion test:
// a bare handler must be flagged, a @RequiresCapability(...)-annotated one
// and a @Public() one must both pass.

import { describe, it } from 'node:test';

import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';

import rule from './require-capability-decorator.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    sourceType: 'module',
  },
});

ruleTester.run('require-capability-decorator', rule, {
  valid: [
    {
      name: 'method annotated with @RequiresCapability(...) passes',
      code: `
        @Controller('throwaway')
        class FixedController {
          @Get('leaky')
          @RequiresCapability(Capability.EDIT_OWN_PROFILE)
          leaky() {
            return { ok: true };
          }
        }
      `,
    },
    {
      name: 'method annotated with @Public() passes',
      code: `
        @Controller('throwaway')
        class PublicController {
          @Get('open')
          @Public()
          open() {
            return { ok: true };
          }
        }
      `,
    },
    {
      name: 'class-level @Public() covers a method with no decorator of its own',
      code: `
        @Controller('throwaway')
        @Public()
        class WhollyPublicController {
          @Get('open')
          open() {
            return { ok: true };
          }
        }
      `,
    },
    {
      name: 'a plain helper method with no HTTP-method decorator is ignored',
      code: `
        @Controller('throwaway')
        class HelperController {
          private helper() {
            return true;
          }
        }
      `,
    },
    {
      name: 'a method on a non-@Controller() class is ignored',
      code: `
        class PlainService {
          @Get('leaky')
          leaky() {
            return { ok: true };
          }
        }
      `,
    },
  ],
  invalid: [
    {
      name: 'a bare handler with neither decorator is flagged',
      code: `
        @Controller('throwaway')
        class LeakyController {
          @Get('leaky')
          leaky() {
            return { ok: true };
          }
        }
      `,
      errors: [{ messageId: 'missingCapability' }],
    },
    {
      name: 'a POST handler with neither decorator is flagged',
      code: `
        @Controller('throwaway')
        class LeakyController {
          @Post('leaky')
          leaky() {
            return { ok: true };
          }
        }
      `,
      errors: [{ messageId: 'missingCapability' }],
    },
  ],
});
