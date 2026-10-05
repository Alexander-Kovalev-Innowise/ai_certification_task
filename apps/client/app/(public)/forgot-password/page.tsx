import { AuthCardLayout } from '../../../src/components/auth/AuthCardLayout';
import { ForgotPasswordForm } from '../../../src/components/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <AuthCardLayout title="Reset your password" subtitle="Enter your email and we will send you a reset link.">
      <ForgotPasswordForm />
    </AuthCardLayout>
  );
}
