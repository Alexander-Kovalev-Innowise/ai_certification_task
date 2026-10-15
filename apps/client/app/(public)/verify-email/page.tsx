import { Suspense } from 'react';

import { AuthCardLayout } from '../../../src/components/auth/AuthCardLayout';
import { VerifyEmailStatus } from '../../../src/components/auth/VerifyEmailStatus';

export default function VerifyEmailPage() {
  return (
    <AuthCardLayout title="Email verification">
      <Suspense fallback={null}>
        <VerifyEmailStatus />
      </Suspense>
    </AuthCardLayout>
  );
}
