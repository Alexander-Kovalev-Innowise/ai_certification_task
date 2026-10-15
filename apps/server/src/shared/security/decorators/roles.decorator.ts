import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

// Task 2.3 (arch §7.1). Read by RolesGuard (Task 2.5) against
// AuthContext.role (always the effective role, never `act` — arch §6.2). No
// @Roles() on a route means available to any authenticated role (still
// subject to tenancy/capability checks downstream).
export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
