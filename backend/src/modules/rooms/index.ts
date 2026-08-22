// PUBLIC API of the rooms module: room lifecycle + seat/presence state.
// Room/seat state lives in Redis; RTC tokens come from the realtime module.
export interface Room { id: string; ownerId: string; title: string; seats: number; }

export async function createRoom(/* ownerId, title */): Promise<Room> {
  // TODO: persist room, init seat map in Redis, return room
  throw new Error('not implemented');
}
export async function joinRoom(/* userId, roomId */): Promise<{ rtcToken: string }> {
  // TODO: add presence in Redis, mint RTC token via realtime module, return it
  throw new Error('not implemented');
}
export async function takeSeat(/* userId, roomId, seatIndex */): Promise<void> {
  throw new Error('not implemented');
}
