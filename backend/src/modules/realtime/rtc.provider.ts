// The RTC provider seam.
//
// Open decision #5 (Agora vs ZEGO vs LiveKit) is recorded as still OPEN, and
// this interface is what keeps that honest. Every LiveKit-specific type stays
// behind it, so the rest of the backend talks about seats and permissions
// rather than about `VideoGrant` and `RoomServiceClient`.
//
// That is not architecture for its own sake. LiveKit is the recommendation
// because it can be self-hosted, and the whole argument for it rests on being
// able to walk away from a vendor. An integration that hard-codes one vendor's
// SDK across four modules cannot walk anywhere.
//
// What a provider must do is small, which is the point: mint a join token, and
// change what a connected participant is allowed to do. Everything else — who
// holds a seat, who is banned, how long the host was live — is ours, and lives
// in Postgres.

/** What a participant may do once connected. Ours, not any SDK's. */
export interface RtcGrants {
  /** May send audio. Seat holders and the host; nobody else. */
  publish: boolean;
  /** May hear others. False only for a shadow-banned viewer. */
  subscribe: boolean;
  /**
   * May send data messages on the media channel.
   *
   * Off by default. Chat and gifts go through our own API so they are
   * moderated, persisted and billed — a client that can broadcast arbitrary
   * data to a room has routed around all three.
   */
  publishData?: boolean;
}

export interface RtcJoinToken {
  token: string;
  /** The media server the client connects to. Served, not bundled, so it can move. */
  url: string;
  /** Unix seconds. The client refuses to start a join it knows has expired. */
  expiresAt: number;
}

export interface RtcProvider {
  readonly name: string;

  /**
   * A short-lived credential to join one room as one identity.
   *
   * Minting is LOCAL — a signature, no network call — which is why joining a
   * room cannot fail because the media server is briefly unreachable.
   */
  mintJoinToken(input: {
    roomName: string;
    identity: string;
    displayName?: string;
    grants: RtcGrants;
  }): Promise<RtcJoinToken>;

  /**
   * Changes what an ALREADY CONNECTED participant may do.
   *
   * This is what promoting someone to a mic seat actually is. Revoking publish
   * also stops whatever they are currently sending — the provider is expected
   * to unpublish their tracks, not merely refuse the next one.
   */
  setParticipantGrants(input: {
    roomName: string;
    identity: string;
    grants: RtcGrants;
  }): Promise<void>;

  /** Silences a participant's live audio without taking their seat. */
  muteParticipant(input: { roomName: string; identity: string; muted: boolean }): Promise<void>;

  /** Disconnects a participant. On its own it does NOT keep them out — see room_bans. */
  removeParticipant(input: { roomName: string; identity: string }): Promise<void>;

  /** Ends the room for everyone still in it. */
  closeRoom(roomName: string): Promise<void>;
}
