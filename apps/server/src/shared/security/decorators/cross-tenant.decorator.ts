import { SetMetadata } from '@nestjs/common';

// Task 2.3 (per the plan's task list), created early in Task 1.8 because
// TenantContextInterceptor needs a marker to read before Task 2.3 formally
// adds the rest of shared/security/decorators/ — same forward-build pattern
// as shared/tenancy (Task 1.6) and shared/security/auth-context (Task 1.7).
//
// Metadata-only here (arch §7.1): this decorator does not itself grant
// cross-tenant access. TenantContextInterceptor is what actually refuses to
// build a PLATFORM TenantScope for a non-SUPER_ADMIN effective role — this
// file just defines the marker it reads.
export const CROSS_TENANT_KEY = 'crossTenant';

export const CrossTenant = () => SetMetadata(CROSS_TENANT_KEY, true);
