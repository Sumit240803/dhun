# Development pipeline

Written for one person. Everything here earns its place or it would not be here —
a process a solo founder does not follow is worse than no process.

---

## The loop

```
1.  Open docs/build-plan.md. Take the next slice.
2.  Work on main. (Branch only if it might not work out.)
3.  npm run check          ← the one thing to be strict about
4.  git commit, git push   ← CI re-verifies
5.  Ship: OTA for JS, store build for native.
```

That's it.

**A slice is one user-visible capability that leaves the app working** — roughly a
day or two. M2 splits into three: phone entry, OTP verify, profile setup. Each
replaces a placeholder route, so `main` is always shippable.

**No pull requests.** Self-review catches little and costs friction. CI runs on
every push to `main`, which is where the real safety net is. This changes the day
a second engineer joins — see the bottom.

**Branch only when the work might be abandoned**: a spike, a risky refactor, a
vendor trial. Everything else goes straight to `main`.

---

## Before every commit

```bash
npm run check      # from the repo root — runs both projects
```

That runs typecheck, lint, format and tests across backend and mobile. If it
passes, push.

Four things it cannot check, so check them yourself:

| If you… | Then… |
|---|---|
| touched an endpoint | update `backend/postman/collection.json` **in the same commit** |
| added a user-facing string | add it to **both** `en.ts` and `hi.ts` |
| added a colour | make it a semantic token in `theme/colors.ts` |
| touched the ledger | resolve its item in `ledger-decisions.md` **first** |

The Postman one is the easiest to skip and the most expensive to skip. A stale
collection means the next debugging session starts with an hour of confusion.

---

## The device loop

The thing worth knowing, because it is the difference between a 5-second
iteration and a 15-minute one:

```
eas build --profile development --platform android     ← ONCE. ~15 min.
npx expo start --dev-client                            ← every day after
```

The development build is a shell. **JS changes hot-reload over Metro** — screens,
logic, styles, everything you write most days.

**Rebuild only when the native layer changes:** a new native module, a config
plugin, a permission, an `app.json` change. Everything else is instant.

If the phone cannot reach the API: it resolves `localhost` to itself. Put your
machine's LAN address in `mobile/.env`. `config/env.ts` warns about this at
startup.

---

## Migrations

Immutable once applied — the runner checksums them and refuses to re-run an
edited file. To change something, add a new migration.

```bash
npm run migrate          # apply pending
npm run migrate:status   # what's applied
npm run db:reset         # wipe and rebuild (dev only)
```

Money is corrected by posting a compensating transaction, never by editing
history. The ledger's append-only trigger enforces that even if you forget.

---

## Shipping

| Change | Path |
|---|---|
| JS only — screens, logic, copy, styles | **EAS Update.** Minutes, no review. |
| Native — new module, permission, `app.json` | **Store build.** Hours to days. |
| A new gift, a price change, a new pack | **Neither.** It is a database row. |

That last row is the point of server-driven config: adding a gift never touches
the app.

Runtime versioning is set to `fingerprint`, which hashes the native layer. An OTA
update physically cannot reach a build whose native side differs — so you cannot
brick users by shipping JS that needs a module they do not have.

---

## Adding a gift

No app release involved.

1. Designer delivers a Lottie `.json` **and the After Effects source**.
2. Upload the JSON to the CDN under `gifts/`.
3. Insert the catalog row — id, tier, coin price, `payout_rate_bp`, effect, asset path.
4. It appears in every client within 30 seconds (the catalog cache TTL).

Keep the AE source every time. Without it the format decision becomes permanent;
with it, a Rive or SVGA version is hours of work.

---

## When something breaks in production

**Kill switch first. Always. Fix second.**

```sql
UPDATE ledger_txn_types SET is_active = false WHERE code = 'gift_send';
```

That stops the flow platform-wide, atomically, with no deploy. Verify it stopped,
then diagnose without the clock running.

Fixing first on a money path means the bug keeps happening while you work — and
every occurrence is a ledger entry you will have to reverse.

For non-money features, `config/flags.ts` does the same job client-side.

Support quotes a `trace_id`. Every error response carries one, every log line is
tagged with it, and Sentry indexes on it.

---

## What changes when the engineer joins

Three things, and only three:

1. **Pull requests become mandatory** — CI already runs on them.
2. **Migrations get renumbered before merge**, never after, or two people create
   `006_` on the same day.
3. **Staging gets built.** Not before M8: until payouts exist, a dev database and
   a preview APK cover it, and a staging environment costs money and attention.

Nothing else about this document changes.
