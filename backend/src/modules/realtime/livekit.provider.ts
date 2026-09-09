// LiveKit, behind the RtcProvider seam.
//
// The only file in the backend that imports `livekit-server-sdk`. Everything
// LiveKit-shaped stops here.
//
// ── Two things read out of the SDK's own type definitions, not its docs ──────
//
// 1. ‼️ `canPublish` OMITTED MEANS PUBLISH IS ENABLED.
//
//    From grants.d.ts, verbatim: "If neither canPublish or canSubscribe is
//    set, both publish and subscribe are enabled." So a listener token that
//    simply leaves the field out lets that listener talk in the room. Every
//    grant below is therefore written EXPLICITLY, including the false ones,
//    and `RtcGrants` has no optional publish field for exactly this reason.
//
//    `canPublishData` behaves the same way — "defaults to true if not set".
//
// 2. The webhook signature header is NOT what the docs say. The docs show
//    `req.get('Authorization')`; the SDK exports `authorizeHeader = "Authorize"`.
//    Both are read at the route, because getting this wrong rejects every
//    webhook with a 401 that looks exactly like a bad secret.

import { AccessToken, RoomServiceClient, TrackType, WebhookReceiver } from 'livekit-server-sdk';
import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import type { RtcGrants, RtcJoinToken, RtcProvider } from './rtc.provider.js';

/**
 * LiveKit speaks WebSocket to clients and HTTPS to servers, and the SDK's
 * admin client wants the HTTP form. Converting here rather than asking for two
 * environment variables that could drift apart.
 */
function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

export class LiveKitProvider implements RtcProvider {
  readonly name = 'livekit';

  private readonly url: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private client: RoomServiceClient | null = null;

  constructor() {
    // Not optional by the time anything constructs this — the factory in
    // realtime.service.ts checks `configured` first and returns a 503 instead.
    // Throwing here would be a 500 on a deploy problem the operator can fix.
    this.url = config.livekit.url!;
    this.apiKey = config.livekit.apiKey!;
    this.apiSecret = config.livekit.apiSecret!;
  }

  /** Lazily built, so an unconfigured process never constructs an HTTP client. */
  private admin(): RoomServiceClient {
    this.client ??= new RoomServiceClient(httpUrl(this.url), this.apiKey, this.apiSecret, {
      // A slow media server must not hold an API request open. The seat the
      // user tapped either works quickly or reports a failure they can retry.
      requestTimeout: config.livekit.requestTimeoutSeconds,
    });
    return this.client;
  }

  async mintJoinToken(input: {
    roomName: string;
    identity: string;
    displayName?: string;
    grants: RtcGrants;
  }): Promise<RtcJoinToken> {
    const ttlSeconds = config.livekit.tokenTtlMinutes * 60;

    const at = new AccessToken(this.apiKey, this.apiSecret, {
      // The identity is the USER ID, and it is what every later admin call
      // addresses. A display name here would collide the moment two people
      // picked the same one, and renaming would orphan their seat.
      identity: input.identity,
      name: input.displayName,
      ttl: ttlSeconds,
    });

    at.addGrant({
      roomJoin: true,
      room: input.roomName,
      // Explicit on every field. See the note at the top of this file: an
      // omitted `canPublish` grants publish, which would let any listener talk.
      canPublish: input.grants.publish,
      canSubscribe: input.grants.subscribe,
      canPublishData: input.grants.publishData ?? false,
      // A participant editing their own metadata could rewrite whatever the UI
      // renders from it. Room state comes from our API, never from the client.
      canUpdateOwnMetadata: false,
      // roomAdmin is deliberately absent. Moderation goes through our endpoints,
      // where it is authorised and recorded; a client holding roomAdmin could
      // kick anyone with no audit trail at all.
    });

    return {
      token: await at.toJwt(),
      url: this.url,
      expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
  }

  async setParticipantGrants(input: {
    roomName: string;
    identity: string;
    grants: RtcGrants;
  }): Promise<void> {
    await this.call('setParticipantGrants', input.roomName, () =>
      this.admin().updateParticipant(input.roomName, input.identity, {
        permission: {
          canPublish: input.grants.publish,
          canSubscribe: input.grants.subscribe,
          canPublishData: input.grants.publishData ?? false,
        },
      }),
    );
  }

  async muteParticipant(input: {
    roomName: string;
    identity: string;
    muted: boolean;
  }): Promise<void> {
    // LiveKit mutes a TRACK, not a participant, so the track has to be found
    // first. A participant with no published audio is already silent, which is
    // a success for the caller's purposes rather than an error.
    await this.call('muteParticipant', input.roomName, async () => {
      const participant = await this.admin().getParticipant(input.roomName, input.identity);
      const audio = participant.tracks.find((track) => track.type === TrackType.AUDIO);
      if (!audio) return;
      await this.admin().mutePublishedTrack(
        input.roomName,
        input.identity,
        audio.sid,
        input.muted,
      );
    });
  }

  async removeParticipant(input: { roomName: string; identity: string }): Promise<void> {
    await this.call('removeParticipant', input.roomName, () =>
      this.admin().removeParticipant(input.roomName, input.identity),
    );
  }

  async closeRoom(roomName: string): Promise<void> {
    await this.call('closeRoom', roomName, () => this.admin().deleteRoom(roomName));
  }

  /**
   * One place where every network call to LiveKit fails.
   *
   * The provider's own message is never passed to the user: it is written for a
   * developer, names internal identifiers, and would put "participant not found
   * in room RM_xxx" on a screen where someone tapped a mic button.
   *
   * The 503 is deliberate over a 500. A media server that is down is a provider
   * outage — the request was valid and retrying it later will work — and the
   * client's error mapper already turns 503 into "try again", which is exactly
   * the right thing for the user to do.
   */
  private async call<T>(operation: string, roomName: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      logger.error('livekit call failed', { operation, room: roomName, err });
      throw new AppError(
        'RTC_UNAVAILABLE',
        'The room service is not responding. Try again.',
        503,
      );
    }
  }
}

/** Verifies the signature on an incoming webhook. Shares the same credentials. */
export function webhookReceiver(): WebhookReceiver {
  return new WebhookReceiver(config.livekit.apiKey!, config.livekit.apiSecret!);
}
