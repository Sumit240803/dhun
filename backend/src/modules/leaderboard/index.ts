// PUBLIC API + event wiring for leaderboards (Redis sorted sets).
//
// It SUBSCRIBES to gift.sent — gifting never calls it directly. Built out in M6
// alongside gifting; see docs/build-plan.md.
//
// Deliberately does not import Redis yet: the API process must start without a
// Redis connection until M5 introduces one.

export function registerLeaderboardSubscribers(): void {
  // M6: subscribe to gift.sent and ZINCRBY the room, daily-host and
  // daily-gifter sorted sets.
}
