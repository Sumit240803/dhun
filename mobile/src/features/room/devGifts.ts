// A DEVELOPMENT-ONLY gift simulator.
//
// Real gifts cost coins, and a busy room is hard to stage with one phone. This
// fakes the gateway's `gift` message from the REAL catalog — real names, tiers,
// prices and asset paths — so the strips and the full-screen layer can be seen
// under load without spending anything or needing five accounts.
//
// Every caller is behind `__DEV__`, and the bundler strips the dead branch from
// a release build.

import type { Gift, GiftView, JoinedRoom } from '@/api/types';
import type { SeatView } from '@/features/room/gateway';

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
  previous: GiftView | null;
}): GiftView | null {
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
    giftIcon: gift.iconAsset,
    tier: gift.tier,
    effect: gift.effect,
    animationAsset: gift.animationAsset,
    coinPrice: gift.coinPrice,
    quantity: MULTIPLIERS[Math.floor(Math.random() * MULTIPLIERS.length)],
  };
}
