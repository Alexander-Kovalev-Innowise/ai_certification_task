import { Suspense } from 'react';

import { AuthCardLayout } from '../../../src/components/auth/AuthCardLayout';
import { ResetPasswordForm } from '../../../src/components/auth/ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <AuthCardLayout title="Set a new password" subtitle="Choose a strong password you have not used before.">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCardLayout>
  );
}
