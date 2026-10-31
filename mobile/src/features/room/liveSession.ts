// A LiveKit connection that outlives the room screen.
//
// Minimising a room means leaving its screen while the audio carries on — the
// one thing a floating player exists for. `useLiveRoom` owns the connection
// for the life of the screen; this is the hand-off: the screen asks for the
// NEXT unmount to park the connection instead of closing it, and whoever
// comes next (the same room re-opened, a different room, the mini player's
// close button) disconnects what was parked.
//
// One parked connection at most. A phone plays one room.

import type { Room } from 'livekit-client';

import { reportError } from '@/lib/reporting';
import { stopAudioSession } from './livekit';

let parked: { key: string; room: Room } | null = null;
let parkNext: string | null = null;

/** Identifies one connection: a join token is minted per join, so this is unique. */
export function sessionKey(url: string | null, token: string | null): string | null {
  return url && token ? `${url}|${token}` : null;
}

export const liveSession = {
  /** The next time this connection's screen unmounts, keep it alive. */
  requestPark(key: string | null): void {
    parkNext = key;
  },

  /** Called from the connection's cleanup. True means "parked — do not disconnect". */
  tryPark(key: string, room: Room): boolean {
    if (parkNext !== key) return false;
    parkNext = null;
    // Only one can be parked; an earlier one is closed first.
    if (parked && parked.key !== key) void disconnect(parked.room);
    parked = { key, room };
    return true;
  },

  isParked(): boolean {
    return parked !== null;
  },

  /** Closes whatever was parked. Safe to call when nothing is. */
  async disconnectParked(): Promise<void> {
    parkNext = null;
    const current = parked;
    parked = null;
    if (current) await disconnect(current.room);
  },
};

async function disconnect(room: Room): Promise<void> {
  try {
    await room.disconnect();
  } catch (error) {
    reportError(error, { code: 'PARKED_DISCONNECT_FAILED', screen: 'room' });
  } finally {
    await stopAudioSession();
  }
}
