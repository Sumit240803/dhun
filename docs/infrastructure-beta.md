# Backend infrastructure — closed beta, first ~1,000 users

The setup to provision, why each piece is what it is, and what breaks first. Day-1
non-negotiable #9 wants this in Terraform; this is the shape Terraform should describe.

**Provider: DigitalOcean, Bangalore (BLR1).** Cheap, has an India region, managed Postgres
with PITR included, one console and one bill. AWS Mumbai is 2–3× the price and more
machinery than a solo founder should be running. Hetzner is cheaper still and has no
India region — 150ms to Frankfurt is unusable for voice.

---

## 1 · What "1,000 users" actually means

Registered-user count is the wrong unit — nothing scales with it. These are the numbers
that drive the sizing, and the ones to check against reality once the beta runs.

| | Estimate | Why |
|---|---|---|
| Registered | 1,000 | The target |
| Daily active | 150–200 | 15–20% is normal for a new social app |
| **Peak concurrent** | **50–80** | Evening peak, 20:00–23:00 IST |
| In rooms at peak | 40–60 | Most concurrency is in a room |
| **Hosts live at once** | **5–12** | Out of 30–50 seeded hosts |

**This is a small load.** The API will be bored. If it falls over, that is a bug, not
capacity.

---

## 2 · The decision that sizes everything: audio or video

Media is the only cost that scales with users, and video is roughly ten times audio.

**Audio-only at peak.** Opus runs ~40 kbps and silence suppression means a non-speaking
participant sends almost nothing; assume 2–3 people actually talking per room.

```
  publishers in    ~30 × 40 kbps       =  1.2 Mbps
  subscribers out  ~60 × 2 × 40 kbps   =  4.8 Mbps
  ───────────────────────────────────────────────
  peak              ~6 Mbps      ≈ 200–650 GB/month
```

Comfortably inside one droplet's included transfer.

**With video**, one 360p publisher at ~600 kbps watched by 30 people is 18 Mbps for a
single room. A PK battle with two video hosts and 100 viewers is ~120 Mbps on its own —
twenty times the entire audio-only estimate.

**Run the beta audio-only.** It is where open decision #1 leans, `videoRoomsEnabled`
already enforces it, and it is the difference between one small LiveKit box and a
bandwidth budget nobody has measured. Enable video for a subset afterwards, with its own
sizing.

---

## 3 · The setup

| # | What | Size | ₹/month |
|---|---|---|---|
| 1 | **App server** — API + workers + Redis | 2 vCPU / 4 GB droplet | 2,000 |
| 2 | **Gateway** — WebSocket | 2 vCPU / 4 GB droplet | 2,000 |
| 3 | **LiveKit** — self-hosted | 4 vCPU / 8 GB droplet | 4,000 |
| 4 | **Postgres** — DO Managed, PITR included | 2 vCPU / 4 GB | 5,000 |
| 5 | **Staging** — all-in-one | 2 vCPU / 2 GB droplet | 1,000 |
| 6 | **Cloudflare R2** — avatars, covers, stand-in art | — | 400 |
| | TLS, firewall, DNS, monitoring | Caddy + DO Firewall + UptimeRobot | 0 |
| | **Total** | | **≈ ₹14,400** |

Against the ₹11L/month fixed cost the model assumes at 10K DAU. **Infrastructure is not
where the beta's money goes** — hosts and moderation are.

### Why the pieces split this way

The split is by **failure domain and deploy cadence**, not by load. Everything would fit
on one machine, and that machine would take the product down on every deploy.

**Gateway apart from the API.** It holds every live WebSocket. An API deploy must not
drop everyone out of their rooms, and a gateway restart must not take REST down with it.
The architecture already requires this.

**LiveKit apart from everything.** The only process with real bandwidth and CPU appetite,
it needs a wide UDP range open to the internet, and it is the piece most likely to need
resizing. Colocating it means the first busy night degrades chat and the API too.

**Postgres managed, same provider, private networking.** Two reasons, and the second is
the one people miss:

1. It holds the double-entry ledger. Automated backups and PITR are the whole argument.
2. **Latency.** The ledger is chatty — one gift send is `BEGIN` → insert txn → insert
   entries → the `withinTransaction` hook writing `gift_sends` → `enqueueEvent` →
   `COMMIT`, six round trips inside one transaction holding locks throughout. On private
   networking that is sub-millisecond. Across clouds — a Mumbai-hosted database talking to
   Bangalore droplets — it is 15–25ms each, so ~120ms added to every gift with the lock
   held for all of it. **Keep the database on the same private network as the three
   processes that hammer it.**

**Redis self-hosted on the app server.** It holds the room bus and rate limits. Losing it
stops chat and seat updates but touches no money, and the API's shutdown path already
handles Redis being absent. That is a far better place to take a ₹1,300/month risk than
the ledger. Run it as its own container so an app deploy does not restart it.

**Workers on the app server.** Idle most of the time; the heaviest is the 03:00 IST
reconciliation, which is the one hour the API is doing nothing. Separate them when payout
batches arrive in M8.

**Staging is not optional.** Day-1 non-negotiable #9, and more practically: 29 migrations
in and the next one touches money. ₹1,000 to run a migration twice before it meets real
data.

---

## 4 · Ports and network

This is where an evening gets lost. LiveKit's requirements are specific and unforgiving.

| Box | Port | Proto | Open to |
|---|---|---|---|
| App | 443 | TCP | Internet — `api.dhun.live` |
| Gateway | 443 | TCP | Internet — `ws.dhun.live` |
| **LiveKit** | **7880** | **TCP** | Internet — signalling |
| **LiveKit** | **7881** | **TCP** | Internet — TURN over TLS |
| **LiveKit** | **50000–60000** | **UDP** | Internet — media (ICE) |
| LiveKit | 3478 | UDP | Internet — TURN |
| Postgres | 5432 | TCP | **App + gateway private IPs only** |
| Redis | 6379 | TCP | **Gateway private IP only** |

**Three things that will bite, all of which already have:**

1. **Do not pin LiveKit to a single UDP port.** It looks tidy and breaks media on
   multi-homed hosts, because replies leave through the wrong socket. The wide ICE range
   is the supported configuration.
2. **Set `--node-ip` to the public address explicitly** on any box with more than one
   interface. Without it LiveKit advertises the wrong ICE candidate and connections fail
   with no useful error.
3. **TCP 7881 is not optional.** Roughly one user in ten is behind a NAT or corporate
   firewall that blocks UDP entirely, and TURN-over-TLS is the only way they reach a room.

TLS via **Caddy** on each box — automatic Let's Encrypt, no load balancer needed at this
scale, no cost.

---

## 5 · Configuration changes from development

| Setting | Dev | Beta |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `OTP_PROVIDER` | `console` | `msg91` — needs DLT first |
| `IAP_PROVIDER` | stub | `google` — needs the Play account |
| `LIVEKIT_URL` | `ws://localhost:7880` | `wss://rtc.dhun.live` — Android blocks plain ws |
| `R2_PUBLIC_URL` | empty | the bucket URL — empty means media answers 503 |
| `CORS_ORIGINS` | localhost | the admin origin only; no wildcard |
| `JWT_SECRET` | anything | 32+ random bytes, **different per environment** |

**Postgres `max_connections`.** The pool is 20 per process across three processes, so
budget 60 plus headroom for migrations and psql. The default 100 is fine; it is the first
number to raise if "too many connections" appears.

**`app_config` is the real configuration.** Gift prices, coin packs, free-coin grants,
wholesale tiers, commission levels, PK dials, the room board and cold-start rules all live
in the database and change with no deploy. None of them are infrastructure.

---

## 6 · Backups

PITR comes with DO Managed Postgres, so the earlier question of whether to pay for it
separately goes away — on Supabase it would have been a ₹8,500/month add-on.

Two rules on top of it:

1. **A manual snapshot immediately before every migration.** PITR's real job is undoing a
   mistake made N hours ago, and at this stage the mistakes that matter are migrations.
   This belongs in `docs/development-pipeline.md` beside `npm run check`.
2. **Purchases are recoverable without backups at all** — the ledger idempotency key
   derives from the provider receipt, so Razorpay and Play hold the authoritative record
   and re-processing produces the same result rather than double-crediting. Gifts are
   not: `gift_sends` is the only record of them.

---

## 7 · What breaks first

In the order it will actually happen:

1. **LiveKit, on the first genuinely busy night.** One box, no failover. Watch its CPU at
   peak — not the API's — and resize before it saturates.
2. **The gateway, on deploy.** Every socket drops and reconnects; the client's backoff
   recovers but the room stutters. Deploy outside 20:00–23:00 IST.
3. **Redis, taking chat with it.** Accepted risk, stated above.
4. **Postgres connections**, if a worker is ever started twice by hand.

---

## 8 · Minimum monitoring

Cheap and not optional:

- **The nightly reconciliation must page a human.** Twelve checks, zero tolerance, 03:00
  IST. A failure means the ledger disagrees with itself.
- **`job_runs`** is the table to watch. A job that silently stops is otherwise invisible.
- **Uptime checks on `/health`** for API and gateway, from outside the VPC. UptimeRobot's
  free tier is enough.
- **LiveKit CPU and bandwidth** at peak.
- **Postgres disk.** The ledger is append-only and only grows.

---

## 9 · What this does not cover

- **Video rooms** — assume ten times the media cost; needs its own exercise.
- **Payouts (M8)** — RazorpayX adds an outbound payment path and a batch worker that
  should move off the app server.
- **Moderation (M9)** — Hive is an outbound call from the workers; cost is per minute
  analysed and belongs in the T&S budget.
- **CDN for gift art** — assets are on R2 with immutable paths, so a CDN in front is a
  later optimisation, not a launch requirement. *(Note: `docs/asset-contract.md` still
  says DigitalOcean Spaces; the code uses R2. R2 is the better choice — zero egress — and
  the contract should be corrected.)*
- **Horizontal scale.** Every piece here is one instance. Correct for 1,000 users, wrong
  for 10,000: the next step is two app servers behind a load balancer and LiveKit in a
  cluster.
