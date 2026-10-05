'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../../lib/api/apiClient';
import { toast } from '../../lib/toast/toast';
import { Card } from '../shared/Card';

// `GET /coaches/:id/availability/overrides` (US-01.10 coach-side
// acknowledgement) - `CoachOverrideNoticeDto`.
export interface CoachOverrideNotice {
  id: string;
  eventId: string;
  reason: string;
  sessionLabel: string | null;
  trainerBusinessName: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface CoachOverrideNoticesProps {
  coachProfileId: string;
}

async function fetchOverrides(coachProfileId: string): Promise<CoachOverrideNotice[]> {
  const res = await apiRequest(`/coaches/${coachProfileId}/availability/overrides`);
  if (!res.ok) {
    throw new Error(`GET /coaches/${coachProfileId}/availability/overrides failed with status ${res.status}`);
  }
  return (await res.json()) as CoachOverrideNotice[];
}

// US-01.10 - shows the coach each time their trainer assigned them to a
// session outside their saved availability (with the trainer's reason) and
// lets them acknowledge it. ("Request change" is deliberately out of scope.)
// Renders nothing while loading, on error, or when there are no overrides, so
// it never gets in the way of the My Times grid.
export function CoachOverrideNotices({ coachProfileId }: CoachOverrideNoticesProps) {
  const queryClient = useQueryClient();
  const queryKey = ['coaches', coachProfileId, 'overrides'];

  const { data } = useQuery({ queryKey, queryFn: () => fetchOverrides(coachProfileId) });

  const acknowledge = useMutation({
    mutationFn: async (overrideId: string) => {
      const res = await apiRequest(`/coaches/${coachProfileId}/availability/overrides/${overrideId}/acknowledge`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`acknowledge failed with status ${res.status}`);
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: () => toast.error('Could not acknowledge the notice. Please try again.'),
  });

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <h2 className="text-block-title font-semibold text-ink">Schedule overrides</h2>
      <p className="mt-xs text-caption text-text-secondary">
        Your trainer assigned you to these sessions even though they fall outside your saved times.
      </p>
      <ul className="mt-md flex flex-col gap-sm">
        {data.map((notice) => (
          <li key={notice.id} className="flex flex-wrap items-start justify-between gap-sm rounded-md border border-border-soft bg-surface-2 p-md">
            <div className="min-w-0">
              <p className="text-body font-semibold text-ink">{notice.sessionLabel ?? 'Session'}</p>
              <p className="text-body text-text-secondary">
                {notice.trainerBusinessName}: {notice.reason}
              </p>
              <p className="text-caption text-text-secondary">{new Date(notice.createdAt).toLocaleString()}</p>
            </div>
            {notice.acknowledgedAt ? (
              <span className="text-caption font-semibold text-success">Acknowledged</span>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(notice.id)}
              >
                Acknowledge
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
