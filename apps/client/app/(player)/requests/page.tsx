'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NewPurchaseRequestModal } from '../../../src/components/player/NewPurchaseRequestModal';
import { PurchaseRequestList, type PurchaseRequestRow } from '../../../src/components/player/PurchaseRequestList';
import { PageHeader, PageLayout } from '../../../src/components/shared/PageLayout';
import { PendingApprovalsListSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { apiRequest } from '../../../src/lib/api/apiClient';

interface RequestsResponse {
  items: PurchaseRequestRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

// An ADULT token gets 403 FORBIDDEN here — the nav link is CHILD-only, so this
// only fires on a direct hit; send the guardian to their own approvals queue.
class NotAChildError extends Error {}

async function fetchRequests(): Promise<RequestsResponse> {
  const res = await apiRequest('/me/purchase-requests?limit=100');
  if (res.status === 403) {
    throw new NotAChildError();
  }
  if (!res.ok) {
    throw new Error(`GET /me/purchase-requests failed with status ${res.status}`);
  }
  return (await res.json()) as RequestsResponse;
}

// `/requests` — the child's own purchase requests (`GET /me/purchase-requests`)
// plus a "New request" modal (`POST /me/purchase-requests`), the stand-in for
// the Epic-02/05 checkout. CHILD sessions only (nav link in roleNav.ts).
export default function RequestsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['me', 'purchase-requests'],
    queryFn: fetchRequests,
    retry: false,
  });

  const isNotChild = error instanceof NotAChildError;

  useEffect(() => {
    if (isNotChild) {
      router.replace('/approvals');
    }
  }, [isNotChild, router]);

  function handleCreated() {
    void queryClient.invalidateQueries({ queryKey: ['me', 'purchase-requests'] });
  }

  const actions = (
    <button type="button" onClick={() => setIsModalOpen(true)} className="btn btn-primary">
      New request
    </button>
  );

  if (isLoading || isNotChild) {
    return (
      <PageLayout>
        <PageHeader title="My requests" />
        <PendingApprovalsListSkeleton />
      </PageLayout>
    );
  }

  if (error || !data) {
    return (
      <PageLayout>
        <PageHeader title="My requests" />
        <p role="alert" className="text-body text-danger">
          Something went wrong loading your requests. Please try again.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader title="My requests" subtitle="Things you asked your parent to approve." actions={actions} />

      <PurchaseRequestList requests={data.items} />

      <NewPurchaseRequestModal key={isModalOpen ? 'open' : 'closed'} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreated={handleCreated} />
    </PageLayout>
  );
}
