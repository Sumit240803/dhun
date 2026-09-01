// The social graph, visitors, and reading a thread.
//
// Every mutation here is idempotent on the server, which is what lets these
// update optimistically: the tap lands instantly, and if the request fails the
// cache rolls back to what the server actually believes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { messagesApi, usersApi } from '@/api/endpoints/feed';
import { queryKeys } from '@/api/queries/keys';
import type { ThreadMessage, Visitor } from '@/api/types';
import { track } from '@/lib/analytics';

export function useVisitors() {
  return useQuery({
    queryKey: queryKeys.profile.visitors(),
    queryFn: async () => (await usersApi.visitors()).visitors,
    staleTime: 30_000,
  });
}

/**
 * Follow or unfollow, optimistically.
 *
 * A follow button that waits for a round trip before changing feels broken on
 * an Indian mobile network — and this is the single most-tapped action in the
 * product, so it has to be instant.
 *
 * The rollback matters as much as the optimism: on failure the cache is
 * restored, so the button never lies about a state the server rejected.
 */
export function useToggleFollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, following }: { userId: string; following: boolean }) =>
      following ? usersApi.unfollow(userId) : usersApi.follow(userId),

    onMutate: async ({ userId, following }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile.visitors() });
      const previous = queryClient.getQueryData<Visitor[]>(queryKeys.profile.visitors());

      queryClient.setQueryData<Visitor[]>(queryKeys.profile.visitors(), (current) =>
        current?.map((visitor) =>
          visitor.userId === userId ? { ...visitor, following: !following } : visitor,
        ),
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.profile.visitors(), context.previous);
      }
    },

    onSuccess: (_data, { userId, following }) => {
      track(following ? 'host_unfollowed' : 'host_followed', { host_id: userId });
    },

    onSettled: () => {
      // The counts on Me and the Following feed both moved. Invalidate rather
      // than patch: a follow changes three separate cached shapes, and keeping
      // all three in sync by hand is how they drift.
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
  });
}

export function useMarkVisitorsSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => usersApi.markVisitorsSeen(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.summary() });
    },
  });
}

/**
 * Records that this user looked at a profile.
 *
 * Fire and forget, and it SWALLOWS failures on purpose: a visit that fails to
 * record is invisible to everyone, where an error banner over a profile the
 * user just opened is not.
 */
export function recordVisit(userId: string): void {
  void usersApi.recordVisit(userId).catch(() => undefined);
}

export function useThreadMessages(threadId: string) {
  return useQuery({
    queryKey: queryKeys.messages.thread(threadId),
    queryFn: async () => (await messagesApi.messages(threadId)).messages,
    staleTime: 10_000,
  });
}

/**
 * Clears the unread badge.
 *
 * Called when a thread is opened, not when it is scrolled to the bottom. The
 * stricter version is more correct and nobody has ever thanked an app for it.
 */
export function useMarkThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (threadId: string) => messagesApi.markRead(threadId),
    onSuccess: () => {
      // Every filter's list AND the tab badge read from this branch.
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages.all });
    },
  });
}

export type { ThreadMessage };
