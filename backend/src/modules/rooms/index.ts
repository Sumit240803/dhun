// PUBLIC API of the rooms module.
//
// The READ side is the feed: listing live rooms is what the app opens on, what
// host seeding fills, and none of its shape depends on the RTC vendor.
//
// The WRITE side is going live, joining, seats and host moderation. It decides
// WHO MAY do something; the realtime module turns that decision into a media
// credential. Nothing here imports an SDK.
//
// Still M5: text chat, the mic-request queue, and the WebSocket gateway that
// carries them. None of those need the media server, and none are built.

export { buildRoomsRouter } from './rooms.routes.js';

export { listFeed } from './rooms.service.js';
export type { FeedRoom, FeedCategory } from './rooms.service.js';

export { endRoom, getRoom, goLive, joinRoom, listSeats } from './live.service.js';
export type { LiveRoom, RoomSeat, RoomTag } from './live.service.js';

export { kickFromRoom, releaseSeat, setSeatMuted, takeSeat } from './seats.service.js';
