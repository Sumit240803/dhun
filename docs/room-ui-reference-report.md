# Live room UI — what the references show, and what we have to make

Read from the 39 screenshots and 4 videos in `app-reference-images/live-rooms-app-references/`
(Poppo Live, by the look of the room IDs and the "Features Center" naming).

**Short answer: you are right.** Roughly **85–90% of what you see in those screenshots is
code**, not pictures. The references look rich because of *density, layering and motion* —
dozens of small pills, chips, counters and gradients stacked over a backdrop — and almost
none of that is an image file. The art budget is concentrated in five places only, four of
which are already on `docs/asset-list.md`.

---

## 1 · What the references actually are — six room types

| # | Type | Seen in | Stage layout |
|---|---|---|---|
| 1 | **PK battle, 1v1 video** | most of them | Two video tiles side by side, score bar above, timer centred |
| 2 | **Team PK** | r22 | Two colour-coded teams, crown on each captain, shared battle bar |
| 3 | **Party room, small** | r20, r34, r37 | Host large at top centre, 8–12 seats in a grid below |
| 4 | **Party room, large** | r26, r28, r29, r31 | 16–20 tiny circular seats, 4 columns × 4–5 rows |
| 5 | **Multi-guest video** | r05, r06, r08 | Two video feeds filling the top half, chat below |
| 6 | **Themed "skin" room** | r24 | Background art with thrones/chairs **drawn into it**, seats positioned onto them |

**All six share one chrome.** The header, the announcement rail, the chat block and the
bottom bar are identical in every screenshot; only the middle changes. That is the single
most useful thing in the whole reference set — it means one `RoomChrome` and a swappable
`<Stage>` covers every type we will ever ship.

---

## 2 · The chrome, element by element — all of it code

### Header, row 1
Host avatar wearing a frame · host name · a follower/points pill · an orange **+** follow
button · a rank-ordered row of 3–5 top-contributor avatars · viewer count · **×** close.

### Header, row 2 — the "activity rail"
`Hour 100+` with a thin progress bar and a percentage · a `Rule` button · `ID:49527145`
· `Team U… 3/9` with a live countdown · `Wish 0/6`.

This rail is why their rooms feel busy and ours feels empty. **Every item is a pill with
text and a number.** No art.

### The marquee strip
A full-width scrolling capsule — `⭐ Dilkhush sent 💎 … won 150,000` — and above it the
global announcements that slide across every room. Gradient background, scrolling text,
a gift icon. One `<Marquee>` component.

### Under the stage
Entry pills (`RahulSingh5547 Joined`) and gift-result banners, both capsules carrying a
level chip, a VIP chip, a coloured name and a gift thumbnail.

### Chat
A **vertical tab rail** down the left edge — `All` / `Room` / `Chat`, text rotated 90° —
then the message list, a `24 new messages` pill, and the long system safety notice in a
translucent panel. Bottom-right, a small floating promo card.

### Bottom bar
`Follow +` (or a `LOL~` composer stub) · a grid icon opening the Features Center · mic ·
the gift button.

### Sheets and modals seen
- **Basic Tools**: Message · Sound · Share · Report · Effect & Msg · Minimize
- **Features Center**: Rank · Rewards · Store · VIP · Gift Center · Bag · Gift Gallery ·
  Gift Collection — eight tiles, two rows of four
- **Waiting for the mic link**: title, two-line body, orange primary, text secondary
- **Get coins for free!**: a chest, a 04:44 countdown, one button

**Every single item in section 2 is code.** Views, gradients, text, Reanimated. Not one
of them needs a designer.

---

## 3 · What genuinely needs art — five things

| # | Asset | On the list already? | Notes |
|---|---|---|---|
| 1 | **Room backdrops** | ✅ shipped (3) | §8 of `asset-contract.md` |
| 2 | **Gift icons** (20) | ✅ `asset-list.md` | |
| 3 | **Gift animations** (10, tiers 3–5) | ✅ `asset-list.md` | The big centre-screen hearts and chests in r26/r31 |
| 4 | **Avatar frames** (3) | ✅ `asset-list.md` | **See the warning below** |
| 5 | **Entry effects** (2) | ✅ `asset-list.md` | The premium join banner |

Plus four *small* pieces that are new, and all four are optional:

| Asset | Size | Could be code instead? |
|---|---|---|
| Gift-box icon for the bottom bar | 1 WebP, 96² | Ionicons `gift` gets ~85% there |
| Host crown for seat 0 | 1 WebP, 72² | Ionicons `star`/`crown` is fine |
| Treasure chest for the free-coin popup | 1 WebP, 400² | Hard to fake in code — worth buying |
| Rank medals (top 3 contributors) | 3 WebP, 72² | A gold/silver/bronze ring in code is enough |
| **PK boundary mascot** | 1 Lottie, 120² | Chevrons alone are enough for v1 — see §3b |

**Country flags in chat need no asset** — emoji flags render natively on Android.
**Level badges need no asset** — already decided: drawn in code on the gift-tier ramp.

---

## 3b · PK battles, in detail

PK is the single most-photographed screen in the reference set, and in apps of this kind it
is the **biggest single driver of gifting revenue** — two hosts compete, and each one's
audience pays to push their side of the bar. It deserves more than the one line I first
gave it.

### Anatomy of the PK stage, top to bottom

| Element | What it is | Code or art? |
|---|---|---|
| **Score bar** | Two proportional fills — magenta left, cyan right — with each side's score at its outer end (`242` … `633`). The boundary sits at the score ratio and slides as gifts land. | **Code** |
| **Boundary marker** | Animated chevrons (`»`) plus a small mascot sprite that rides the boundary like a tug-of-war flag. | **ART** — the only one on this screen |
| **Timer** | A `PK` starburst badge and `02:24` counting down, in a dark pill centred over the bar. | Code (starburst is a tiny optional asset) |
| **Win multiplier** | `Win x2` … `Win x4` with an octagon badge carrying a streak number, one per side. Earned by consecutive wins. | **Code** |
| **Mute toggle** | Top-right of the opponent's tile — mute the other side's audio. | **Code** |
| **Video tiles** | Two 50/50 tiles. LiveKit tracks, nothing more. | **Code** |
| **Supporter strip** | Under each tile, a row of 3–4 small circular avatars — that side's top gifters — plus a combo marker (`x3`, `x135`) and a mic icon. | **Code** |
| **Quick message** | A pink speech bubble the host pops over their own tile: *"Pwease win pk for me"*. | **Code** |
| **Gift banners** | Overlay the tiles rather than sitting below them: `pe… send WIN — won 160,000`. | Code + the gift icon |

**So the whole PK screen needs exactly one new art file**, and even that could ship as a
code-drawn chevron cluster for v1.

### Team PK (r22) is the same component with more seats

Two colour-coded teams, a crown on each captain, one shared battle bar, several small seats
per side. The header carries a `Team U… 3/9` recruiting pill with its own countdown. If the
1v1 bar is built as "two sides and a ratio", team mode is a prop change, not a new screen.

### What PK costs on the BACKEND — and it is not small

None of the above is the hard part. PK needs:

- a `pk_battles` table with the two rooms, start, duration and state;
- **matchmaking** — random pairing is what the `Random PK Winner` marquee refers to;
- **scoring derived from gift timestamps**, per side, inside the battle window;
- win streaks, and the multiplier that follows from them;
- a settlement at the final whistle, plus what happens when one host drops mid-battle.

**This is a milestone of its own (M13-sized), not a UI task.** The chrome and stage work in
section 6 does not depend on it, which is why PK sits at step 7 there.

### Two rules PK must not break

1. **The `Win x4` multiplier must scale the DISPLAYED SCORE only — never the payout.**
   A multiplier that also multiplied points would move the payout ratio off ~30% on every
   battle, and the ratio is set by one number (`coins per ₹ ÷ 433.4`). Score is a game
   number; points are money. Keep them in separate columns.
2. **Gifts are gifts — never pooled, never refunded to the losing side.** A viewer gifting
   a host is a purchase. If the losers' gifts were returned, or the winner took a pot
   funded by both audiences, it stops being gifting and becomes a wager on an uncertain
   outcome — which is hard rule #1 territory. The winner gets the streak badge and the
   bragging rights; everyone keeps the gifts they were sent.

---

## 3c · Four more screens I under-reported

| Screen | Seen in | Notes |
|---|---|---|
| **Fan Club** | r18 | A sheet: `Rank 100+`, `Fans 119`, `Fan group`, then three privilege tiles — Sort priority, Fan badge, Exclusive gift — and `Join Fan Club · 100`. A paid membership per host. All code; the fan badge is a chip. **Not in our build plan at all.** |
| **Right-side guest strip** | r10, r11 | A vertical column of co-host cards, each with avatar, name, a gift-count badge and a mute indicator, with a collapse chevron. This is how multi-guest video rooms show who is on. All code. |
| **Mic-link has three states** | r12, r13, r23 | "Waiting for the mic link" (continue / disconnect) · "On the mic link list" (confirm) · **"Only followers can join the mic — please follow the host first"**. That last one is a product rule we have not got: a follow gate on seat requests. All code. |
| **Per-seat counters** | r19, pk-support crop | Each party seat carries its number top-left and a pink gift-count badge top-right, so you can see who is being gifted at a glance. All code, and it reads off data our ledger already has. |

---

## 4 · Three warnings from the references

### ⚠️ The frames in these screenshots are ANIMATED. Ours are specified static.

Look at r28 and r31: the top seats wear wings that flap and crowns that glitter. Our
asset contract fixes frames as **static WebP** ≤60 KB, and the stated reason still holds —
a frame is drawn on every avatar in every list, so animating it costs performance on every
scrolling row.

**The compromise I would make:** static frames everywhere *except* the room stage, where
at most 8–20 are on screen and they are the thing people pay for. That means a second,
optional `frames/{id}/anim.v1.json` Lottie alongside the static WebP, used only by the
seat grid. It is a contract change, so it is your call — but shipping only static frames
will read as cheaper than the references, and frames are a revenue item.

### ⚠️ The themed room (r24) bakes the furniture into the background.

That palace backdrop has thrones drawn at specific pixel positions, and avatars sit *on*
them. It looks fantastic and it is a trap: every new backdrop then needs its own seat
coordinate map, and a 9-seat skin cannot be reused for a 16-seat room.

**Recommendation: keep backdrops neutral** — scenery only, no furniture — and let code
position seats. That is how our three current ones work. If you want themed skins later,
they become a separate asset class with a coordinate file, not a backdrop.

### ⚠️ Two things in these screenshots we must not copy

- **"Golden Flower"** appears as a room tag in the Explore grid (r14). It is a card game.
  Hard rule #1 — paid chance-based games are an existential risk under the Online Gaming
  Act 2025. The *room type* is fine; the game is not.
- **`agency join 4278959`** scrolls in the marquee (v4). We decided on 2026-10-05 that
  there is **no agency directory in the app** — a marquee advertising agency IDs is the
  same Play-billing trigger by another route.

The **"Get coins for free!"** chest with a countdown is fine — it is a free grant on a
timer, exactly like our check-in and watch rewards.

---

## 5 · The one structural change we need

**Our room shows seats OR chat. Theirs shows seats AND chat, always.**

`room/[id].tsx` currently puts a `SegmentedTabs` between `seats` and `chat`. Every
reference screenshot has the stage occupying the top ~45% and the chat permanently below
it, with gifts and entries flowing between them. That is not a styling difference — it is
why their rooms feel alive and ours feels like a form.

This is the first thing to change, and it is pure layout work:

```
┌─ header (host, follow, viewers, ×)        ┐
├─ activity rail (hour rank, team, room id) │  chrome, fixed
├─ marquee                                  ┘
├─ STAGE — swappable per room type          ← the only part that varies
├─ entry + gift banners                     ┐
├─ chat (tab rail + list + new-msgs pill)   │  chrome, flex
└─ bottom bar (composer, features, gift)    ┘
```

---

## 6 · Suggested build order

Everything here is code unless marked.

1. **Split the room into `RoomChrome` + `<Stage>`** and drop the seats/chat tabs. Biggest
   visual gain, no new assets.
2. **Activity rail + marquee.** Pills, counters, a scrolling capsule. Needs new endpoints
   for hourly rank — can ship with the room ID and viewer count first.
3. **Stage: party-room grid at any capacity.** One component, sized by `seatCapacity`,
   covering types 3 and 4.
4. **Entry and gift banners below the stage**, with level and VIP chips.
5. **Chat block** — vertical tab rail, new-message pill, system notice panel.
6. **Bottom bar + Features Center sheet.** Most tiles open screens that do not exist yet;
   ship the sheet with the four that do and grey the rest.
7. **Stage: PK battle.** Score bar, timer, multiplier badges. Needs backend work (a PK
   table, scoring) — this is a milestone of its own, not a UI task.
8. **Art swap.** Gifts, frames, entry effects, when the designer delivers.

Steps 1–6 are achievable without a single new image, against the three backdrops already
in place.
