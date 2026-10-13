# The live room

Six room types, one set of chrome, one swappable middle. Built against the 39
screenshots and 4 videos in `app-reference-images/live-rooms-app-references/`
— **read those before changing layout here**, and keep following them.

```
┌─ RoomHeader ──── host · follow · top gifters · viewers · ×   ┐
├─ ActivityRail ── rank · rules · room code                    │ chrome, fixed
├─ RoomMarquee ─── "X sent Y ×3 to Z"                          ┘
├─ <Stage> ─────── seats │ video │ pk │ solo   ← the only part that varies
├─ RoomChatPanel ─ filter rail · lines · events · new-msgs pill
└─ RoomComposer ── say something · mic · camera · ⌘ · gift
```

**The stage and the chat are both on screen, always.** This replaced a
segmented tab that showed seats _or_ chat. Nothing else in the rewrite matters
as much: a room where you cannot watch and talk at the same time is a form with
avatars on it, and no amount of styling fixes that.

---

## Files

| Path                                   | What it is                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `RoomScreen.tsx`                       | Composition. Owns the three connections and the layers.                             |
| `model.ts`                             | **The keystone.** Turns room + seats + pk into a tagged `StageModel`. Pure, tested. |
| `roomAssets.ts`                        | Every piece of room art not yet drawn, with its spec. The outstanding brief.        |
| `media.tsx`                            | Who has a camera on, as a context.                                                  |
| `stage/Stage.tsx`                      | The exhaustive switch on `StageModel.kind`.                                         |
| `stage/SeatGridStage.tsx`              | Party rooms, 2–20 seats.                                                            |
| `stage/VideoStage.tsx`                 | One or two tiles plus the right-edge mic rail.                                      |
| `stage/MicRail.tsx`                    | Everyone on mic who is not on a tile.                                               |
| `stage/SeatTile.tsx`                   | One seat: empty, taken, speaking, muted.                                            |
| `stage/RemoteVideo.tsx`                | A camera track, or the avatar fallback.                                             |
| `pk/types.ts`                          | PK state **and the two rules that must not be broken**.                             |
| `pk/PkStage.tsx` · `pk/PkScoreBar.tsx` | The battle.                                                                         |
| `pk/devPk.ts`                          | `__DEV__` simulator — there is no PK backend yet.                                   |
| `chrome/*`                             | Header, rail, marquee, chat, composer, sheets, dialogs.                             |

---

## Rules that are load-bearing

**1. `buildStage()` decides the layout, not the components.** Six room types
used to mean conditions scattered across one 990-line file until nobody could
say what a video host with two guests rendered. The model is a tagged union so
the switch in `Stage.tsx` is exhaustive — a seventh stage kind will not compile
until it is handled.

**2. PK's `winMultiplier` never touches money.** It scales the displayed score
only. The payout ratio is set by one number (`coins per ₹ ÷ 433.4`), and a
multiplier reaching the ledger would move it on every battle. Score is a game
number; points are money; separate fields for that reason.

**3. PK gifts are never pooled or refunded.** A viewer gifting a host is a
purchase. Return the losers' gifts, or hand the winner a pot funded by both
audiences, and it stops being gifting and becomes a wager on an uncertain
outcome — hard rule #1. The winner gets a streak badge.

**4. Timed queues are external stores, not component state.** `MarqueeQueue`
follows `GiftStripLanes` and `GiftQueue`. Announcements arrive at whatever rate
a combo produces; mirroring them into state means a `setState` in an effect per
gift and a re-render of the room each time.

**5. Nothing imports an image.** Components resolve a path through
`roomAssets.ts` and draw a code fallback while it returns null. One grep for
`available: false` is the art order.

**6. The seat NUMBER and the gift COUNTER are not decoration.** In a twenty-seat
room the counter is how a gifter finds who is being gifted, and the number is
how somebody asks for "seat 7" in chat.

---

## What is wired, and what is waiting

|                                               | State                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seats, mic, chat, gifts, cosmetics, backdrops | Live against real endpoints                                                                                                                                               |
| Top gifters, per-seat counters                | Live — `useRoomLeaderboard`, polled while the room is open                                                                                                                |
| Video tiles, camera publish/flip, mic rail    | Built; needs `videoRoomsEnabled` and a device to verify                                                                                                                   |
| **PK battles**                                | **UI complete, no backend.** Needs `pk_battles`, matchmaking, scoring from gift timestamps, streaks, settlement — a milestone of its own. `devPk.ts` drives it meanwhile. |
| Hourly rank (`ActivityRail rank`)             | Passed `null`. Needs a ranking endpoint.                                                                                                                                  |
| Fan club                                      | Not built. In the references; not in our plan.                                                                                                                            |
| Share, minimise                               | Disabled tiles in the features sheet, labelled.                                                                                                                           |
