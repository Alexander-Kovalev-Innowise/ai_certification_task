import { AuthCardLayout } from '../../../../src/components/auth/AuthCardLayout';
import { CampSignupFlow } from '../../../../src/components/camp/CampSignupFlow';

// Camp-to-User Conversion, Epic-01 side: a public stand-in for the Epic-08 camp / evaluation form. After the
// submission the person is offered to create an account (the join page arrives pre-filled from the stored
// sign-up) or to get the join link by email for later. `[code]` is the trainer's PLAYER_STATIC ShareLink code.
export default async function CampSignupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <AuthCardLayout
      title="Camp / evaluation sign-up (Epic-08 stand-in)"
      subtitle="Tell us about the player. You can create your PracticePerfect account right after."
    >
      <CampSignupFlow code={code} />
    </AuthCardLayout>
  );
}
