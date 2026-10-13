import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { pkApi } from '@/api/endpoints/pk';
import { queryKeys } from '@/api/queries/keys';
import type { PkBattle } from '@/api/types';

/**
 * The battle this room is in, if any.
 *
 * ── Fetched once, then pushed ───────────────────────────────────────────────
 *
 * A viewer arriving mid-battle needs the bar immediately, which is the query.
 * Everything after that arrives over the gateway as `pk:score` — one message
 * per gift to either host — so this does NOT poll. A three-minute battle
 * polled every second is a hundred and eighty requests per viewer, and the
 * socket is already open and already carrying the gift that moved the number.
 *
 * `pushed` wins over the query result for the same reason the seat map does:
 * the socket is the live source and the fetch is only what fills the screen in
 * the moment before it connects.
 */
export function usePk(roomId: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.pk.room(roomId ?? ''),
    queryFn: async () => (await pkApi.forRoom(roomId!)).pk,
    enabled: enabled && roomId !== undefined,
    staleTime: 10_000,
    // A room with no battle is the common case and a perfectly good answer.
    // Retrying it would be a request per room open for nothing.
    retry: false,
  });

  /**
   * The last pushed battle, TAGGED with the room it arrived for.
   *
   * The tag is what makes this correct without an effect: leaving a room
   * mid-battle and opening another one must not show the first room's bar, and
   * clearing it from an effect on `roomId` would be writing state in response
   * to a prop that is already available during render.
   */
  const [pushed, setPushed] = useState<{ roomId: string; battle: PkBattle } | null>(null);

  const onPushed = useCallback(
    (battle: PkBattle) => {
      if (roomId === undefined) return;
      setPushed({ roomId, battle });
    },
    [roomId],
  );

  const live = pushed !== null && pushed.roomId === roomId ? pushed.battle : null;

  return {
    pk: live ?? query.data ?? null,
    /** Called by the room socket for `pk:started`, `pk:score` and `pk:ended`. */
    onPushed,
  };
}
