// PUBLIC API + event wiring for the platform-wide leaderboards.
//
// NOT the room leaderboard. That one lives in `gifting` and is read straight
// from `gift_sends`, which is written in the same transaction as the money — a
// board inside a room is small, exact, and needs no second copy of the data.
//
// What is left here are the boards that span the whole platform — daily top
// hosts, daily top gifters — which are too large to aggregate per request and
// are the case sorted sets exist for. They subscribe to `gift_sent` from the
// outbox and are M10 (discovery), not M6.

export function registerLeaderboardSubscribers(): void {
  // M10: consume gift_sent and ZINCRBY the daily-host and daily-gifter sets.
}
