import { ShareLinkDispatcher } from '../../../../src/components/share-link/ShareLinkDispatcher';

// fe §4.2 "/join/[code]" — @Public() route, the single most branchy route
// in the app. This server leaf only resolves the dynamic `code` segment;
// every stateful/client concern (the two-stage GET-then-POST state machine)
// lives in <ShareLinkDispatcher>.
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[var(--surface-0)] p-lg">
      <div className="w-full max-w-md">
        <ShareLinkDispatcher code={code} />
      </div>
    </main>
  );
}
