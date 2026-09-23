import { Reflector } from '@nestjs/core';

import { Capability } from '../capability.enum';

import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { REQUIRES_CAPABILITY_KEY, RequiresCapability } from './requires-capability.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

// Task 2.3 — metadata-only decorators; no Testcontainers needed. Verifies
// each decorator attaches the metadata key/value the guards built in this
// phase (RolesGuard, CapabilitiesGuard, JwtAuthGuard) read.
describe('security decorators (Task 2.3)', () => {
  const reflector = new Reflector();

  it('@Public() sets isPublic = true', () => {
    class Controller {
      @Public()
      handler() {}
    }
    expect(reflector.get(IS_PUBLIC_KEY, new Controller().handler)).toBe(true);
  });

  it('@Roles(...) sets the roles array', () => {
    class Controller {
      @Roles('TRAINER', 'SUPER_ADMIN')
      handler() {}
    }
    expect(reflector.get(ROLES_KEY, new Controller().handler)).toEqual(['TRAINER', 'SUPER_ADMIN']);
  });

  it('@RequiresCapability(...) sets the capability array', () => {
    class Controller {
      @RequiresCapability(Capability.EDIT_OWN_PROFILE)
      handler() {}
    }
    expect(reflector.get(REQUIRES_CAPABILITY_KEY, new Controller().handler)).toEqual([
      Capability.EDIT_OWN_PROFILE,
    ]);
  });
});
