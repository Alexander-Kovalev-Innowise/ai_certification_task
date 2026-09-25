'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ShareLinkTableSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { GenerateShareLinkModal, type GenerateShareLinkResult } from '../../../src/components/trainer/GenerateShareLinkModal';
import { ShareLinkTable, type ShareLinkRow } from '../../../src/components/trainer/ShareLinkTable';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §4.4 GET /trainers/:id/share-links — `PaginatedResponseDto<ShareLinkRowDto>`.
interface ShareLinksPageResponse {
  items: ShareLinkRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

function hasTrainerProfileId(data: unknown): data is { trainerProfile: { id: string } } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'trainerProfile' in data &&
    typeof (data as { trainerProfile?: unknown }).trainerProfile === 'object' &&
    (data as { trainerProfile: { id?: unknown } }).trainerProfile !== null &&
    typeof (data as { trainerProfile: { id?: unknown } }).trainerProfile.id === 'string'
  );
}

async function fetchShareLinks(trainerId: string, cursor: string | null): Promise<ShareLinksPageResponse> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  const res = await apiRequest(`/trainers/${trainerId}/share-links?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`GET /trainers/${trainerId}/share-links failed with status ${res.status}`);
  }
  return (await res.json()) as ShareLinksPageResponse;
}

// fe §4.4 — `/share-links`: GET /trainers/:id/share-links (own trainerId
// read off GET /me/bootstrap's TRAINER shape) + GenerateShareLinkModal
// (POST /share-links) + optimistic revoke (DELETE /share-links/:id, fe
// §9.4 — row fades immediately via `pendingRevokeIds`, rolls back on
// failure). Task 13.3. Wrapped by `(trainer)/layout.tsx`'s
// RoleGuard(TRAINER).
export default function ShareLinksPage() {
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [pendingRevokeIds, setPendingRevokeIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: bootstrap } = useBootstrap();
  const trainerId = hasTrainerProfileId(bootstrap) ? bootstrap.trainerProfile.id : null;

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['share-links', trainerId],
    queryFn: ({ pageParam }) => fetchShareLinks(trainerId as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: !!trainerId,
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(`/share-links/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`DELETE /share-links/${id} failed with status ${res.status}`);
      }
    },
    onMutate: (id: string) => {
      setPendingRevokeIds((current) => [...current, id]);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['share-links', trainerId] }),
    onError: (_error, id: string) => {
      setPendingRevokeIds((current) => current.filter((pendingId) => pendingId !== id));
    },
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-lg p-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Share Links</h1>
        <button
          type="button"
          onClick={() => setIsGenerateModalOpen(true)}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary"
        >
          Generate Link
        </button>
      </div>

      {isLoading && <ShareLinkTableSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading your share links. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <ShareLinkTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          onRevoke={(id) => revokeMutation.mutate(id)}
          pendingRevokeIds={pendingRevokeIds}
        />
      )}

      <GenerateShareLinkModal
        key={isGenerateModalOpen ? 'open' : 'closed'}
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onGenerated={(_result: GenerateShareLinkResult) => void queryClient.invalidateQueries({ queryKey: ['share-links', trainerId] })}
      />
    </section>
  );
}
