// Who a gift can go to, from where the viewer is sitting.
//
// The server accepts the host or anyone on a seat, and refuses a gift to
// yourself. This mirrors that rule so the sheet never offers a choice the
// server will reject — a tap that ends in an error is worse than an option
// that was never shown.

export interface GiftRecipient {
  userId: string;
  name: string;
  isHost: boolean;
}

export function giftRecipients(input: {
  hostId: string;
  hostName: string | null;
  seats: { seatIndex: number; userId: string; displayName: string | null }[];
  meId: string | undefined;
}): GiftRecipient[] {
  const recipients: GiftRecipient[] = [];

  // The host first — it is their room, and the common case by far.
  if (input.hostId !== input.meId) {
    recipients.push({ userId: input.hostId, name: input.hostName ?? '—', isHost: true });
  }

  const seen = new Set([input.hostId]);
  for (const seat of [...input.seats].sort((a, b) => a.seatIndex - b.seatIndex)) {
    if (seen.has(seat.userId) || seat.userId === input.meId) continue;
    seen.add(seat.userId);
    recipients.push({ userId: seat.userId, name: seat.displayName ?? '—', isHost: false });
  }

  return recipients;
}
