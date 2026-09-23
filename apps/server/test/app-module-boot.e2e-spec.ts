import { Controller, Get, Type } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { assertRoutesHaveRequiredCapability } from '../src/shared/security/assert-routes-have-capability';
import { Capability } from '../src/shared/security/capability.enum';
import { Public } from '../src/shared/security/decorators/public.decorator';
import { RequiresCapability } from '../src/shared/security/decorators/requires-capability.decorator';

// Task 2.8 (arch §9.2/§20 DoD). Exercises assertRoutesHaveRequiredCapability
// directly against a deliberately-broken throwaway controller/TestingModule
// — never against the real, static AppModule (which can't be mutated at
// test time) — per the plan's own note that this kind of test module is
// "temporary/local to the spec file, not shipped code".
describe('Boot-time capability assertion (Task 2.8 DoD)', () => {
  async function buildDiscoveryContext(ControllerClass: Type<unknown>) {
    return Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [ControllerClass],
      providers: [Reflector],
    }).compile();
  }

  it('fails startup when a non-@Public() route lacks @RequiresCapability(...)', async () => {
    @Controller('throwaway')
    class ThrowawayController {
      @Get('leaky')
      leaky() {
        return { ok: true };
      }
    }

    const moduleRef = await buildDiscoveryContext(ThrowawayController);
    const app = moduleRef.createNestApplication();

    const discoveryService = moduleRef.get(DiscoveryService);
    const metadataScanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    expect(() => assertRoutesHaveRequiredCapability(discoveryService, metadataScanner, reflector)).toThrow(
      /ThrowawayController\.leaky\(\)/,
    );

    await app.close();
  });

  it('boots cleanly once the gap is fixed with @RequiresCapability(...)', async () => {
    @Controller('throwaway')
    class FixedController {
      @Get('leaky')
      @RequiresCapability(Capability.EDIT_OWN_PROFILE)
      leaky() {
        return { ok: true };
      }
    }

    const moduleRef = await buildDiscoveryContext(FixedController);
    const app = moduleRef.createNestApplication();

    const discoveryService = moduleRef.get(DiscoveryService);
    const metadataScanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    expect(() => assertRoutesHaveRequiredCapability(discoveryService, metadataScanner, reflector)).not.toThrow();

    await app.close();
  });

  it('also boots cleanly for a @Public() route with no capability at all', async () => {
    @Controller('throwaway')
    class PublicController {
      @Get('open')
      @Public()
      open() {
        return { ok: true };
      }
    }

    const moduleRef = await buildDiscoveryContext(PublicController);
    const app = moduleRef.createNestApplication();

    const discoveryService = moduleRef.get(DiscoveryService);
    const metadataScanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);

    expect(() => assertRoutesHaveRequiredCapability(discoveryService, metadataScanner, reflector)).not.toThrow();

    await app.close();
  });
});
