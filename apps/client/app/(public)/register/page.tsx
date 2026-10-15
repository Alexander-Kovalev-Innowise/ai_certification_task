import { Suspense } from 'react';

import { AuthCardLayout } from '../../../src/components/auth/AuthCardLayout';
import { TrainerSetupForm } from '../../../src/components/auth/TrainerSetupForm';

export default function RegisterPage() {
  return (
    <AuthCardLayout title="Complete your account" subtitle="Set your password to finish setting up your trainer account.">
      <Suspense fallback={null}>
        <TrainerSetupForm />
      </Suspense>
    </AuthCardLayout>
  );
}
