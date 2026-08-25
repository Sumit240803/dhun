# Dhun mobile — architecture and conventions

The frontend equivalent of `backend/docs/ledger-decisions.md`: decisions get made
here first, then built. Read this before adding a file.

Project rules live in the repository root `CLAUDE.md`. Expo-specific notes are in
`AGENTS.md`.

---

## The one rule that matters

**Dependencies point downward, never up.**

```
app/         routes — compose screens, nothing else
   ↓
features/    screens and the logic behind them
   ↓
ui/  visuals/    presentation. No business logic, no API calls.
   ↓
theme/  lib/  api/  config/     tokens, pure helpers, server contract
```

A file in `ui/` may never import from `features/`. A file in `lib/` may never
import React. When something needs to go upward, it becomes a prop or a callback.

This is what keeps a gifting sheet from quietly depending on the room screen,
which is how these apps become impossible to change.

---

## Directory map

| Directory          | Holds                                                                                                                                                                     | Never holds                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `app/`             | expo-router routes. A route file should be under ~30 lines: read params, render a feature screen.                                                                         | Business logic, data fetching, styling          |
| `features/<name>/` | Screens, hooks, and logic for one feature. `features/gifting/GiftSheet.tsx`, `features/wallet/usePurchase.ts`                                                             | Design-system primitives                        |
| `ui/`              | The ten design-system primitives: `Screen`, `Row`/`Column`, `Text`, `Button`, `Input`, `Card`, `ListItem`, `Avatar`, `Badge`, `Divider`, `Sheet`. Styled, dumb, reusable. | Anything that knows about coins, rooms or hosts |
| `visuals/`         | **The distinctive layer.** Gift animations, profile frames, entry effects, level badges — everything server-driven and asset-backed.                                      | Layout scaffolding                              |
| `api/`             | The server contract: client, types, endpoint functions, query hooks                                                                                                       | UI                                              |
| `lib/`             | Pure functions. Money formatting, dates, validation. Testable without a renderer.                                                                                         | React, navigation, anything with side effects   |
| `theme/`           | Tokens only: colour, spacing, radius, typography, z-index                                                                                                                 | Components                                      |
| `config/`          | Environment access, validated once at startup                                                                                                                             | Anything read from more than one place          |
| `store/`           | Global client state that is genuinely global (session, active room)                                                                                                       | Server data — that belongs to TanStack Query    |

---

## Routing

Routes are grouped so the layout tree matches the auth state.

```
app/
  _layout.tsx                 providers + Stack.Protected guards
  index.tsx                   splash / session bootstrap

  (auth)/                     NOT REGISTERED — includes a guest
    phone.tsx
    otp.tsx

  (app)/                      requires a session (guest OR registered)
    profile-setup.tsx         runs AFTER verification, so it cannot live in (auth)
    (tabs)/
      index.tsx               live feed
      following.tsx
      search.tsx
      wallet.tsx
      me.tsx
    room/[id].tsx             the room — the core screen
    wallet/
      packs.tsx
      transactions.tsx
    host/
      go-live.tsx
      earnings.tsx

  legal/                      publicly reachable, no session required
    privacy.tsx
    terms.tsx
    guidelines.tsx
    grievance.tsx             IT Rules 2021 — the Grievance Officer contact
                              must be reachable in-app
```

**Guards use `Stack.Protected`**, not redirect effects. It is declarative, and it
cleans navigation history when a screen becomes inaccessible — so a signed-out
user cannot swipe back into the wallet.

Two distinct guards, because they are different questions:

- `isAuthenticated` — has a session at all (a guest counts)
- `isRegistered` — phone verified; required before anything that spends

**`(auth)` is gated on `!isRegistered`, not on `!isAuthenticated`.** A guest holds
a real server-side identity, so gating on authentication would lock them out of
the one screen that upgrades them to a phone account — and their coins with it.

The mirror of that is why **`profile-setup` lives in `(app)`**. It runs after the
OTP is verified, at which point the user IS registered; had it stayed in `(auth)`
the guard would flip false and `Stack.Protected` would unmount the screen out
from under the navigation that was trying to reach it.

The 18+ gate is **not** a route guard. The backend enforces it per money endpoint
and returns `DOB_REQUIRED`, which the client turns into a date picker rather than
a dead end.

---

## The primitive set

`ui/` holds the primitives and no more. Import them from `@/ui`.

|                         |                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `Screen`                | Page container. Background, safe-area insets, optional scroll + keyboard lift.            |
| `Row` `Column` `Spacer` | Layout. `gap` only accepts a spacing-scale key, so an arbitrary 13px gap is a type error. |
| `Text`                  | `variant` (typography scale) + `tone` (semantic colour). Never a free-form colour.        |
| `Button`                | `primary` / `secondary` / `danger` / `ghost`, three sizes, loading and disabled.          |
| `Input`                 | Label, focus ring, error slot.                                                            |
| `Card`                  | Solid or `glass` for laying over video. `selected` for a chosen coin pack.                |
| `ListItem`              | 56pt minimum row, so every list clears the 44pt touch target.                             |
| `Avatar`                | Five sizes, initial fallback, `live` ring.                                                |
| `Badge`                 | Currency, tier and status chips.                                                          |
| `Divider`               | Hairline. Decorative — hidden from screen readers.                                        |

**There is no component library, and this is deliberate.** Tamagui, Paper and
gluestack were all considered and rejected for the same three reasons: each
brings its own theme system, which would be a second source of colour truth
next to `theme/colors.ts`; the generic surface a library covers is about ten
components, all of which get restyled anyway in a heavily-branded app; and this
stack (RN 0.86 + React 19.2 + React Compiler + New Architecture) is new enough
that library breakage costs more than the components save. Nothing in this
category — Bigo, Poppo, TikTok, Discord — ships on an off-the-shelf kit.

The decision is also asymmetric, which is the real argument: owning the
primitives leaves the door open to adopting a library for one screen later,
while adopting one spreads its idiom into every screen and makes removal a
rewrite. Revisit only if web becomes a first-class target — that is the case
Tamagui genuinely wins.

Three single-purpose libraries carry their weight and are used directly:

- **`@gorhom/bottom-sheet`** — wrapped by `ui/Sheet`. Gestures, snap points,
  keyboard, backdrop. Needs `BottomSheetModalProvider` and
  `GestureHandlerRootView`; both are wired in `app/_layout.tsx`.
- **`@shopify/flash-list`** — the feed and the chat stream. `FlatList` drops
  frames during a gift storm, which is exactly when it must not.
- **`react-native-keyboard-controller`** — `Screen scroll` uses it. Also
  provides `KeyboardProvider` at the root.

**Feature-specific components do not belong here.** A gift tile, a coin pack
card and a host header live in `features/`. The test: would this component
still make sense in an app that was not about live streaming?

## The visuals layer

This app is mostly pictures of things people paid for. That deserves its own
layer rather than being scattered through feature code.

**Every visual is server-driven.** Day-1 non-negotiable #6: adding a gift must
never require an app release. So nothing here hardcodes a gift, a frame or an
effect — they all render from catalog data.

```
visuals/
  GiftAnimation.tsx     plays a gift by tier
  ProfileFrame.tsx      wraps an avatar in an owned frame
  EntryEffect.tsx       the room-entry animation
  ChatBubble.tsx        cosmetic chat styling
  LevelBadge.tsx        user L1-70, host L1-60
  assets.ts             resolution, caching, preloading
```

### Rendering by tier

The gift catalog's `effect` column drives presentation:

| `effect`              | Renders as                                             |
| --------------------- | ------------------------------------------------------ |
| `basic`               | Inline in the message stream                           |
| `fullscreen`          | Full-screen overlay, queued so two gifts never overlap |
| `room_banner`         | Persistent banner plus a host notification             |
| `global_announcement` | Cross-room announcement (Tier 5)                       |

### Every visual has a three-step fallback

```
animation  →  static image  →  name as text
```

A failed asset must never blank the screen or crash the room. A user who paid
₹282 for a Yacht and sees nothing will not pay again, and a thrown error inside
the room screen takes down the stream too.

### Caching

Assets are immutable per id — a gift's animation never changes in place, it gets
a new id. So cache aggressively and **preload on catalog fetch**, not on first
open of the gift sheet. The sheet must feel instant; it is the moment money is
spent.

On cellular, only Tier 1–2 are prefetched. This audience is largely on metered
tier-2 data, and silently burning it on animations they may never see is a way
to get uninstalled.

### The format: Lottie

Decided after checking what is actually maintained, not what the industry uses.

| Package                   | Last published                              |
| ------------------------- | ------------------------------------------- |
| `lottie-react-native`     | actively maintained                         |
| `rive-react-native`       | actively maintained                         |
| `react-native-svga`       | **2022** — abandoned                        |
| `svgaplayer-react-native` | **2022** — abandoned                        |
| PAG (`libpag`)            | maintained, but **no React Native binding** |

**SVGA is the category standard** — Bigo, Poppo, MLive and Chamet all use it, and
the gift marketplaces sell it. It is unusable here: both bindings died in 2022,
before the New Architecture, and RN 0.82 removed the old bridge entirely.

That is structural, not bad luck. Every app using SVGA or PAG is _native_
Android/iOS — those formats came from Chinese platform teams with in-house native
engineers who never needed a React Native binding.

Lottie wins on **hiring**, not on technology: After Effects via Bodymovin is the
workflow every Indian motion designer already knows. Rive is the better runtime —
smaller files, state machines, used by Duolingo and Spotify — but that talent pool
in India is thin.

**Briefing a designer:** After Effects → Bodymovin, 750×750 minimum, under 500KB,
transparent background, no expressions, no merge paths. **Always keep the AE
source** — that is what keeps the format decision reversible.

Nothing is baked in: `animation_asset` is a plain string and `effect` drives
rendering separately, so a Rive renderer could be added per gift later.

### The queue

Tier 3+ gifts take over the screen for 3–6 seconds. During a whale moment
hundreds arrive in that window, so the queue **sheds load — and sheds the cheap
gifts**. Dropping a ₹15,000 Galaxy because two hundred Roses queued ahead of it
is a refund request and a lost whale.

- Tier 1–2 never queue; they render inline so a flood of Roses cannot block the screen
- Higher tiers jump the queue but **never interrupt** what is playing — a truncated animation reads as a bug
- Capped at 8: at 3s each that is already 24 seconds behind live
- Deduplicated by transaction id, since the fast path and the outbox can both deliver
- Cleared on room change, so a gift never follows you out

The queue is a subscribable store read with `useSyncExternalStore`, not mirrored
into component state — mirroring means a setState per gift and a cascading render
during exactly the moment that needs to be smooth.

---

## Colour

**One source. Two layers. Enforced by lint.**

```
theme/primitives.ts    raw scales (rose500, neutral900)   ← never imported by components
theme/colors.ts        semantic tokens (text.primary)     ← the ONLY colour import
theme/tokens.ts        spacing, radius, type, z-index, timing
theme/index.ts         the public surface
```

Components import from `@/theme` and nothing else:

```ts
import { colors, spacing } from '@/theme';

backgroundColor: colors.bg.surface; // ✅
color: colors.text.secondary; // ✅
backgroundColor: '#15151D'; // ❌ lint error
import { primitives } from '@/theme/primitives'; // ❌ lint error
```

### Why two layers

Primitives are named for what a colour **is** (`rose500`). Semantic tokens are
named for what it is **for** (`brand.solid`, `text.faint`, `currency.coin`).

Rebranding then means remapping a handful of semantic tokens inside `theme/` —
not hunting `#FF4D6D` through eighty screens. Changing the brand from rose to
amber is one edit; every button, badge and focus ring follows.

### Enforcement

`eslint.config.js` makes three things errors anywhere under `src/` except
`src/theme/`:

| Rejected                     | Why                                                      |
| ---------------------------- | -------------------------------------------------------- |
| `'#RRGGBB'` literals         | A single source of truth that can be bypassed is not one |
| `rgb()` / `rgba()` / `hsl()` | Same, via the other syntax                               |
| importing `theme/primitives` | Reaching past the semantic layer defeats the point       |

These are **errors, not warnings**. An inconsistency caught at authoring time
costs nothing; one discovered on screen forty, where two greys almost match, is
a day of archaeology.

### Reserved tokens

Three sets must never be reused for anything else:

- **`colors.currency.*`** — coin gold, gem violet, point green. A user has to
  tell them apart at a glance, mid-stream, without reading the label. Borrowing
  coin gold for a warning badge destroys that.
- **`colors.tier[1..5]`** — the gift ladder escalates visibly, and the escalation
  is the product. Indexed so `colors.tier[gift.tier]` works straight from the API.
- **`colors.status.live`** — the live dot. Never an error colour.

### Adding a colour

1. Is there a semantic token that fits? Use it.
2. If not, add a **semantic** token in `colors.ts` pointing at an existing primitive.
3. Only if no primitive fits, add one to `primitives.ts` first.

Never skip to step 3, and never write a hex outside `theme/`.

### Light by default, dark kept in step

`colors.ts` defines TWO complete palettes with identical shapes, and `MODE`
picks which one is exported. Light ships.

The light palette is warm — ivory rather than white, warm near-black rather
than grey. A pure-grey light UI reads clinical, and the ivory base is also what
lets a white card read as a card rather than as more page.

Three tokens carry the polarity so components never have to:

- `text.onBrand` — text on a saturated brand or status fill. Near-black in
  **both** palettes, deliberately: white on the brand rose is 3.2:1 and fails AA
  for a 15px label, where near-black is 6:1. A hot pink wants dark text on it.
- `brand.accent` — brand-coloured _text_, darker than `brand.solid`, because a
  link must clear 4.5:1 against the page where a button surface need not.
- `glass.wash` — the veil that pushes media back so foreground text wins. White
  over a light page, black over a dark one.

`MODE` is also what the few polarity-aware platform APIs read: the status bar
style and the date picker's `themeVariant`. If you find yourself writing
`"dark"` as a literal anywhere, use `MODE` instead.

**Static, not a context.** Screens read these inside `StyleSheet.create`, which
runs once at module load. Making the palette reactive would mean a hook in every
component — that is the change to make when per-user theme switching is actually
wanted, and not before.

## Mock data

Anything the UI shows that has no endpoint yet lives in **`src/mocks/`**, and
nothing outside `api/queries/` imports from it. See `src/mocks/README.md`.

The seam is one line per resource:

```ts
queryFn: () => fromMock(mockRooms(category)),   // TODO(api): roomsApi.feed(category)
```

Screens call the hook and cannot tell the difference — which is the point.
When the endpoint lands, the screen does not change, its loading, empty and
error states already exist, and the diff is that one line.

Two rules that make it work:

1. **Mocks are typed against the API types, not against themselves.** They are
   the spec the UI was built to — start from them when building the endpoint.
2. **`fromMock()` adds latency on purpose.** A mock that resolves synchronously
   renders every screen already-loaded, so the skeletons are never seen and
   never found to be wrong until the real network is slower than assumed.

Mock the UNFLATTERING state. `following` returns an empty list and the profile
summary returns all zeroes, because that is what a real new account looks like
and it is the state most likely to ship broken.

## Money formatting

**Never format a currency inline.** Always `lib/money.ts`.

Four distinct things, four functions, no implicit conversion between them:

```ts
formatCoins(16445); // "16,445"
formatGems(5355); // "5,355"
formatPoints(11700); // "11,700"
formatRupees(29900); // "₹299"      ← input is PAISE, never rupees
```

**Indian digit grouping is the default.** `164945` renders as **1,64,945**, not
`164,945` — the lakh system is what an Indian user expects, and getting it wrong
looks foreign immediately.

Money is always an integer. Paise never becomes a float, and coins are never
divided in the client — the server sends the number to display.

---

## Environment and configuration

**One file reads `process.env`: `config/env.ts`.** It validates at startup and
throws loudly on a missing value, so a misconfigured build fails at launch rather
than at the payment screen.

`EXPO_PUBLIC_*` values are **inlined into the bundle at build time** and readable
by anyone with the APK. They are configuration, never secrets. Anything secret
lives on the server — there is no such thing as a secret in a mobile app.

Per-environment values are set in `eas.json` build profiles, not in `.env`, since
EAS builds never see the local file.

---

## Naming and file conventions

| Thing        | Convention                                 | Example             |
| ------------ | ------------------------------------------ | ------------------- |
| Components   | PascalCase file and export                 | `GiftSheet.tsx`     |
| Hooks        | `use` prefix, camelCase file               | `useWallet.ts`      |
| Pure helpers | camelCase                                  | `money.ts`          |
| Routes       | kebab-case, expo-router owns the name      | `profile-setup.tsx` |
| Types        | PascalCase, colocated or in `api/types.ts` | `CoinPack`          |

Imports use the `@/` alias — never `../../..`.

---

## State

**Server data belongs to TanStack Query.** Wallet balance, catalogs, room lists —
all of it. Do not mirror server data into a store; that is how a balance shows
16,445 on one screen and 9,945 on another.

**`store/` is only for client state that is genuinely global**: the session, the
active room, a queued gift animation.

Query keys are centralised in `api/queries/keys.ts` so an invalidation after a
purchase cannot miss a screen.

---

## Error handling

The backend returns a stable envelope: `{ error: { code, message, details, trace_id } }`.

- **Switch on `code`**, never on the status or the message.
- `DOB_REQUIRED` opens the date picker. `REGISTRATION_REQUIRED` opens the phone
  flow. `INSUFFICIENT_BALANCE` opens the pack sheet. Each is an opportunity, not
  an error toast.
- The server's `message` is already sanitised and safe to show.
- Log `trace_id` on failures — support quotes it.

---

## Localisation

**Every user-facing string goes through `t()`. No exceptions, from the first screen.**

```ts
import { useTranslation } from '@/i18n';
const { t } = useTranslation();
t('auth.otpSubtitle', { phone });
```

Hand-rolled rather than a library, for one reason: **typed keys**. `t('auth.otpTitl')`
is a compile error, not a blank label found in QA — or worse, in a language nobody
on the team reads.

- `en.ts` is the source catalogue; `hi.ts` is typed against it, so a missing key
  fails the build.
- **Never concatenate translated fragments.** Hindi is subject-object-verb, so
  `'You sent ' + gift + ' to ' + host` cannot be reordered. Write whole sentences
  with named placeholders — `'{sender} sent {gift} to {host}'`.
- Missing Hindi falls back to English; missing English shows the key, which is a
  bug report that writes itself.

This exists before any screen because retrofitting it after forty is a week of
mechanical edits, and regional language is the positioning bet.

---

## Errors and reporting

**Error boundaries are layered, not just at the root.** A single top-level boundary
means a failed gift animation takes down the entire room, including the video the
host is streaming.

```tsx
<ErrorBoundary screen="room">
  {' '}
  // room chrome survives
  <ErrorBoundary // only the effect is lost
    screen="room.gifts"
    fallback={() => null}
  >
    <GiftAnimationLayer />
  </ErrorBoundary>
</ErrorBoundary>
```

`lib/reporting.ts` wraps Sentry behind an interface and no-ops without a DSN. It
scrubs `Authorization` and `Idempotency-Key` before sending, never attaches
screenshots (a room is other people's faces), and tags every report with the
`trace_id` from the API envelope — which is what turns "the app broke" into one
server log line.

---

## Analytics

`lib/analytics.ts` holds the client half of the event taxonomy from
`data-and-launch-plan-v1`, as a **typed union**. That doc's warning is that
changing an event schema later loses your history, so the names are locked at
compile time.

Common properties attach automatically. The doc is explicit about why: attached by
hand, roughly a fifth of events end up missing them.

Events double as crash breadcrumbs — the last five actions before a crash are
usually more useful than the stack.

---

## Feature flags

`config/flags.ts` is the client half of day-1 non-negotiable #5. The server owns
the money-layer switch (`ledger_txn_types.is_active`); this covers everything else.

Defaults are local and conservative; remote values override. One flag is worth
knowing about: **`showWebRechargeLink` defaults to false and must stay that way**
in-app — a purchase within 24 hours of an in-app link click still incurs Google's
20% fee.

---

## Network

`lib/network.ts` tracks `isInternetReachable`, not `isConnected` — a phone on a
Wi-Fi network with no upstream reports connected, which is the captive-portal case
that produces silent failures.

The audience is largely tier-2 and tier-3 India on patchy data. "Nothing happened
when I tapped" is almost always a dropped request, and saying so is the difference
between a retry and an uninstall.

---

## Deep links

`config/links.ts` maps both schemes to the same routes. Not cosmetic: host share
links are a Phase 0 acquisition channel, and a link that lands on the home screen
instead of the room wastes the click.

Path builders live beside the route tree so a renamed route breaks loudly, rather
than producing links that silently 404 months after they were shared.

---

## Testing

`lib/` is pure and gets unit tests — money formatting especially, because a
rounding or grouping bug there is wrong on every screen at once.

```
npm test           jest-expo
npm run typecheck
npx expo lint      includes the colour rules
npm run format:check
```

CI runs all four on every push, for both the backend and the app, plus a guard
that no `.env` file is ever tracked. The colour enforcement only works if it runs.

Components are tested where behaviour is non-obvious — the gift queue, the retry
path, a button that must not fire twice — not for snapshot coverage.

**`render` is asynchronous** in react-native-testing-library 14: it awaits
React 19's concurrent commit. Forget the `await` and you get a Promise whose
query methods are all undefined, reported as "render function has not been
called", which points nowhere near the actual mistake.

```ts
const screen = await render(<Button label="Send code" onPress={fn} loading />);
expect(screen.getByTestId('btn')).toBeBusy();
```

The v14 matchers are `toBeBusy()` / `toBeDisabled()` / `toBeOnTheScreen()` /
`toHaveProp()`. `toHaveAccessibilityState()` was removed.
