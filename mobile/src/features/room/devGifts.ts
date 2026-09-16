// A DEVELOPMENT-ONLY gift simulator.
//
// Sending a real gift is M6 — the ledger transaction, the idempotency key and
// the 18+ gate all need their decisions settled first. Until then there is
// nothing that publishes a gift, so the strips could not be seen on a device at
// all. This fakes the gateway's `gift` message from the REAL catalog, so what
// shows is a real gift name, tier and price rather than invented data.
//
// Every caller is behind `__DEV__`, and the bundler strips the dead branch from
// a release build.

import type { Gift, JoinedRoom } from '@/api/types';
import type { SeatView } from '@/features/room/gateway';
import type { GiftStripEvent } from '@/visuals/giftStrips';

const SENDERS = [
  { id: 'dev-asha', name: 'Asha' },
  { id: 'dev-rohan', name: 'Rohan' },
  { id: 'dev-meera', name: 'Meera' },
  { id: 'dev-kabir', name: 'Kabir' },
  { id: 'dev-zoya', name: 'Zoya' },
];

const MULTIPLIERS = [1, 1, 1, 10, 99];

let counter = 0;

/**
 * One plausible gift.
 *
 * Repeats the previous sender and gift half the time, deliberately — combos are
 * the case most worth seeing, and random picks would almost never produce one.
 */
export function simulateGift(input: {
  catalog: Gift[];
  room: JoinedRoom['room'];
  seats: SeatView[];
  previous: GiftStripEvent | null;
}): GiftStripEvent | null {
  const { catalog, room, seats, previous } = input;
  if (catalog.length === 0) return null;

  counter += 1;

  if (previous && Math.random() < 0.5) {
    return { ...previous, id: `dev-gift-${Date.now()}-${counter}`, quantity: 1 };
  }

  const sender = SENDERS[Math.floor(Math.random() * SENDERS.length)];
  const gift = catalog[Math.floor(Math.random() * catalog.length)];

  // In a party room, sometimes gift someone on a seat rather than the host, so
  // the "sent X to Y" wording gets exercised too.
  const seated = seats.filter((seat) => seat.userId !== room.hostId);
  const toSeat = seated.length > 0 && Math.random() < 0.3;
  const recipient = toSeat ? seated[Math.floor(Math.random() * seated.length)] : null;

  return {
    id: `dev-gift-${Date.now()}-${counter}`,
    senderId: sender.id,
    senderName: sender.name,
    senderAvatar: null,
    senderFrame: null,
    recipientId: recipient?.userId ?? room.hostId,
    recipientName: recipient?.displayName ?? room.hostName,
    giftId: gift.id,
    giftName: gift.name,
    giftIcon: null,
    tier: gift.tier,
    coinPrice: gift.coinPrice,
    quantity: MULTIPLIERS[Math.floor(Math.random() * MULTIPLIERS.length)],
  };
}
