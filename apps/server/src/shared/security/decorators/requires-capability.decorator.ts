import { SetMetadata } from '@nestjs/common';

import type { Capability } from '../capability.enum';

// Task 2.3 (arch §7.1/§9.2). Read by CapabilitiesGuard (Task 2.6) — fine
// grained, child-account-aware gate. Every non-@Public() route must carry
// this (enforced by the boot-time assertion, Task 2.8), so a new endpoint
// added later defaults to "denied" rather than silently open to CHILD
// accounts if nobody annotates it.
export const REQUIRES_CAPABILITY_KEY = 'requiresCapability';

export const RequiresCapability = (...capabilities: Capability[]) =>
  SetMetadata(REQUIRES_CAPABILITY_KEY, capabilities);
