// PUBLIC API of the realtime module.
//
// Responsibility: RTC token minting, participant permissions, and the media
// server's webhooks. The provider (LiveKit today — open decision #5) is an
// implementation detail that stops at this boundary.
//
// Other modules import ONLY from this file — never from internal files.

export { buildWebhooksRouter } from './webhooks.routes.js';

export { announceRoomEnded, announceSeats } from './announce.js';

export {
  closeRoom,
  isRtcConfigured,
  LISTENER_GRANTS,
  mintJoinToken,
  muteParticipant,
  removeParticipant,
  roomNameFor,
  setGrants,
  SPEAKER_GRANTS,
} from './realtime.service.js';

export type { RtcGrants, RtcJoinToken, RtcProvider } from './rtc.provider.js';
