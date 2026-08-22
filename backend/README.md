# Dhun backend — modular monolith

One deployable Node/TypeScript service, internally split into modules with hard
boundaries. It runs as a monolith now and extracts into microservices cleanly
later, along the seams already drawn here.

## The three rules

1. **Modules talk only through `index.ts`.** Every module exposes a public API in
   its `index.ts`. Other modules import *only* from there — never from another
   module's internal files (`*.service.ts`, `*.repo.ts`). When you later extract a
   module into its own service, its `index.ts` becomes the network API and nothing
   else changes.

2. **`economy` is the sole writer of wallet balances.** No other module touches
   the `wallets` or `ledger_entries` tables. Gifting, payments, and games all move
   money by calling `economy`'s public functions (`sendGift`, `creditCoins`, …),
   each with an idempotency key, each inside a single DB transaction. This is what
   guarantees financial integrity — and why `economy` stays un-split the longest.

3. **Side effects go through the event bus.** A module does its own work, then
   publishes an event (`gift.sent`). Reactors (`leaderboard`, `notifications`)
   subscribe — they are never called directly. Today the bus is in-process
   (`src/infra/eventBus.ts`); swap that one file for Kafka/RabbitMQ later and the
   subscribers move out untouched.

## Layout

```
src/
  server.ts          bootstraps infra, wires subscribers, starts http
  app.ts             mounts module routes
  config/            env-validated config (zod)
  infra/             db (+ withTransaction), redis, eventBus, logger, errors
  middleware/        authGuard, rateLimit, validate
  shared/            cross-cutting types (branded IDs, Coins/Diamonds)
  modules/
    auth users realtime rooms chat economy payments
    games leaderboard moderation notifications admin
```

Each module (when built out) follows:
`x.routes.ts → x.controller.ts → x.service.ts → x.repo.ts → x.types.ts → index.ts`

## Worked examples already in the repo

- **`economy/`** — fully sketched: the append-only double-entry `ledger.service.ts`,
  the atomic `gifting.service.ts`, and the public `index.ts`. Read this first.
- **`leaderboard/`** — the event-subscriber pattern (reacts to `gift.sent`).
- **`payments/`** — depends on `economy` through its public API only.
- **`migrations/001_init.sql`** — the `wallets` + `ledger_entries` schema.

## Build order (solo)

Build vertical slices — a feature's backend *and* its UI together — not all
backend then all UI. Spine first (`auth`, then the `economy` ledger core, plus the
real-time + IAP spikes), then slice feature by feature: rooms → chat → gifting →
leaderboard → games.

## Extraction seams (when the team grows)

Extract along module boundaries. Likely first: `realtime`/`rooms` (scale with
concurrent room load) and `leaderboard` (event-driven, Redis-heavy). Keep
`economy` + `payments` together as long as possible for transactional integrity.

## Run

```bash
cp .env.example .env      # fill in DATABASE_URL, REDIS_URL, JWT_SECRET
npm install
# apply migrations/001_init.sql to your Postgres
npm run dev
```
