// The realtime module's own logic: pick a provider, name rooms, mint tokens.
//
// Everything here is vendor-neutral. The one LiveKit-specific file is
// livekit.provider.ts, reached only through the RtcProvider interface.

import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { LiveKitProvider } from './livekit.provider.js';
import type { RtcGrants, RtcJoinToken, RtcProvider } from './rtc.provider.js';

let provider: RtcProvider | null = null;

/**
 * The configured provider, or a clean 503.
 *
 * An unconfigured machine is a normal state — a developer working on the wallet
 * has no reason to run a media server — so the rest of the app boots and only
 * the RTC endpoints refuse. The alternative, throwing at startup, makes the
 * whole backend unusable because one optional dependency is absent.
 */
export function rtc(): RtcProvider {
  if (!config.livekit.configured) {
    throw new AppError(
      'RTC_UNAVAILABLE',
      'Live rooms are not available right now',
      503,
    );
  }
  provider ??= new LiveKitProvider();
  return provider;
}

/** Whether RTC can serve at all. Lets a caller degrade instead of failing. */
export function isRtcConfigured(): boolean {
  return config.livekit.configured;
}

/**
 * The media room's name.
 *
 * Derived from our room id rather than stored, so the two can never drift and
 * there is no second identifier to keep in sync. The prefix makes a stray room
 * on the media server identifiable at a glance when debugging.
 */
export function roomNameFor(roomId: string): string {
  return `dhun-${roomId}`;
}

/** Recovers our room id from a media room name. Used by the webhook handler. */
export function roomIdFrom(roomName: string): string | null {
  return roomName.startsWith('dhun-') ? roomName.slice('dhun-'.length) : null;
}

/**
 * A join credential for one user in one room.
 *
 * `publish` is the ONLY thing that decides whether they can talk, and it is
 * decided by the caller from the seat table — never from anything the client
 * sent. That is the whole authorisation boundary of the media plane.
 */
export async function mintJoinToken(input: {
  roomId: string;
  userId: string;
  displayName?: string;
  grants: RtcGrants;
}): Promise<RtcJoinToken> {
  return rtc().mintJoinToken({
    roomName: roomNameFor(input.roomId),
    identity: input.userId,
    displayName: input.displayName,
    grants: input.grants,
  });
}

/** Changes what a connected participant may do — the seat promotion primitive. */
export async function setGrants(input: {
  roomId: string;
  userId: string;
  grants: RtcGrants;
}): Promise<void> {
  await rtc().setParticipantGrants({
    roomName: roomNameFor(input.roomId),
    identity: input.userId,
    grants: input.grants,
  });
}

export async function muteParticipant(input: {
  roomId: string;
  userId: string;
  muted: boolean;
}): Promise<void> {
  await rtc().muteParticipant({
    roomName: roomNameFor(input.roomId),
    identity: input.userId,
    muted: input.muted,
  });
}

export async function removeParticipant(input: {
  roomId: string;
  userId: string;
}): Promise<void> {
  await rtc().removeParticipant({
    roomName: roomNameFor(input.roomId),
    identity: input.userId,
  });
}

export async function closeRoom(roomId: string): Promise<void> {
  await rtc().closeRoom(roomNameFor(roomId));
}

/**
 * The grants a listener gets. Written once so no caller can forget the `false`.
 *
 * See livekit.provider.ts: an omitted publish flag means publish is ENABLED,
 * so "the default" is the dangerous case and there must be no way to reach it
 * by accident.
 */
export const LISTENER_GRANTS: RtcGrants = { publish: false, subscribe: true, publishData: false };
export const SPEAKER_GRANTS: RtcGrants = { publish: true, subscribe: true, publishData: false };
