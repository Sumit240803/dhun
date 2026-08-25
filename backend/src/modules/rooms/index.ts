// PUBLIC API of the rooms module.
//
// The READ side is built: listing live rooms is what the app opens on, what
// host seeding fills, and none of its shape depends on the RTC vendor.
//
// Joining, seats and presence are M5 — they need the realtime gateway and a
// vendor decision (open decision #5), and writing them now would mean guessing
// at a token exchange.

export { buildRoomsRouter } from './rooms.routes.js';
export { listFeed } from './rooms.service.js';
export type { FeedRoom, FeedCategory } from './rooms.service.js';

export async function joinRoom(/* userId, roomId */): Promise<{ rtcToken: string }> {
  // M5: add presence, mint an RTC token via the realtime module, return it.
  throw new Error('not implemented');
}

export async function takeSeat(/* userId, roomId, seatIndex */): Promise<void> {
  // M5.
  throw new Error('not implemented');
}
