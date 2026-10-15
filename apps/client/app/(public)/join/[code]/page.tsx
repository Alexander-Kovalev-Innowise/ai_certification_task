import { ShareLinkDispatcher } from '../../../../src/components/share-link/ShareLinkDispatcher';

// fe §4.2 "/join/[code]" — @Public() route, the single most branchy route
// in the app. This server leaf only resolves the dynamic `code` segment;
// every stateful/client concern (the two-stage GET-then-POST state machine)
// lives in <ShareLinkDispatcher>.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams?: Promise<{ camp?: string | string[] }>;
}) {
  const { code } = await params;
  // `?camp=<token>` comes from the camp/evaluation sign-up (stand-in page /camp/[code] or the "register later" email).
  const camp = (await searchParams)?.camp;
  const campToken = (Array.isArray(camp) ? camp[0] : camp) || null;

  return (
    <main className="flex min-h-screen w-full items-center justify-center p-lg">
      <div className="w-full max-w-[28rem]">
        <ShareLinkDispatcher code={code} campToken={campToken} />
      </div>
    </main>
  );
}
