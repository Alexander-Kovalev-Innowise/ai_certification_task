'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '../lib/api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import type { NotificationsResponse } from '../types/notifications';

export const NOTIFICATIONS_REFETCH_MS = 60_000;

async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await apiRequest('/me/notifications');
  if (!res.ok) {
    throw new Error(`GET /me/notifications failed with status ${res.status}`);
  }
  return (await res.json()) as NotificationsResponse;
}

// The in-app notification feed (US-01.05 / US-01.10). Keyed by the effective
// user id so an identity switch never shows the previous user's items. Polls
// every 60 s and refetches when the window regains focus.
export function useNotifications() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const queryKey = ['notifications', userId];

  const query = useQuery({
    queryKey,
    queryFn: fetchNotifications,
    enabled: userId !== null,
    refetchInterval: NOTIFICATIONS_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: false,
  });

  // Optimistically flips the items to read, then reconciles with the server.
  const mutate = useMutation({
    mutationFn: async (itemId: string | null) => {
      const path = itemId === null ? '/me/notifications/read-all' : `/me/notifications/${encodeURIComponent(itemId)}/read`;
      const res = await apiRequest(path, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`POST ${path} failed with status ${res.status}`);
      }
    },
    onMutate: async (itemId) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<NotificationsResponse>(queryKey, (current) => {
        if (!current) return current;
        const items = current.items.map((item) => (itemId === null || item.id === itemId ? { ...item, read: true } : item));
        return { items, unreadCount: items.filter((item) => !item.read).length };
      });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  return {
    ...query,
    markRead: (itemId: string) => mutate.mutate(itemId),
    markAllRead: () => mutate.mutate(null),
  };
}
