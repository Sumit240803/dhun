# Asset contract

**What every visual asset must be, before a single one is drawn.**

The app is built with placeholder art and real art is swapped in last. That only works
if the placeholders and the real assets obey the same contract — sizes, canvases,
formats, budgets — so the swap changes pixels and nothing else. A placeholder frame
drawn on the wrong canvas means every real frame arrives misaligned, at the point in
the project where fixing layout is most expensive.

This document is that contract. It is also the technical appendix to every art brief.

**The rule that makes the swap cheap:** assets are never bundled into the app. The
catalog stores a path, the app resolves it against the CDN (`visuals/assets.ts`), and
replacing art is uploading files and updating catalog rows — no app release. Day-1
non-negotiable #6.

---

## 1 · Conventions for every asset

| | |
|---|---|
| **Hosting** | DigitalOcean Spaces + CDN, Bangalore. Resolved via `EXPO_PUBLIC_ASSET_URL`. |
| **Paths are immutable** | A file at a path never changes. New art gets a new version: `gifts/yacht/anim.v2.json`. The client caches forever on that assumption, so overwriting a path means some users see old art indefinitely. |
| **Path scheme** | `gifts/{giftId}/icon.v{n}.webp` · `gifts/{giftId}/anim.v{n}.json` · `frames/{cosmeticId}.v{n}.webp` · `entry/{cosmeticId}.v{n}.json` · `badges/{id}.v{n}.webp` |
| **Static images** | WebP, transparent background, sRGB. PNG only if a tool cannot export WebP. |
| **Animations** | Lottie JSON exported from After Effects via Bodymovin. |
| **Density** | Static art is delivered at **@3x** of its largest on-screen size. |
| **Source files** | `.aep`, `.psd`, `.blend` etc. are part of every delivery and stored outside the app repo. The source is what keeps the format decision reversible. |
| **Licensing** | Every asset has a recorded rights holder. Nothing extracted from another app, ever — not even temporarily. |

---

## 2 · Gift icons

The static picture of a gift. Shown in the gift sheet grid, in the gift strips, and
anywhere a gift is named.

| | |
|---|---|
| **Canvas** | **256 × 256 px**, transparent |
| **Safe area** | Subject inside the central **216 × 216 px**. Glow, sparkle and shadow may use the margin; nothing is cropped by the canvas edge. |
| **Budget** | ≤ **30 KB** each |
| **Style** | All 20 icons in **one** art direction. The gift sheet shows every tier side by side, and one mismatched icon makes the whole grid look cheap. |
| **Lighting** | One consistent key light across the set (upper left), so the grid reads as a family. |
| **Needed for** | **Every gift, all tiers.** |

---

## 3 · Gift animations

### Which gifts need one

| Tier | Effect | Needs an animation? | Why |
|---|---|---|---|
| 1 Impulse | `basic` | **No** | Nothing plays it. The full-screen layer skips `basic` gifts by design, and the gift strip is their display. |
| 2 Regular | `basic` | **No** | Same. |
| 3 Statement | `fullscreen` | **Yes** — 5 gifts | Plays over the room. |
| 4 Flex | `room_banner` | **Yes** — 3 gifts | Plays over the room. |
| 5 Global | `global_announcement` | **Yes** — 2 gifts | Plays over the room. |

**Ten animations in total, not twenty.** Commissioning Tier 1–2 animations would pay
for art no user ever sees.

### Canvas, timing and budget

| | Tier 3 | Tier 4 | Tier 5 |
|---|---|---|---|
| **Canvas** | 750 × 750 | 750 × 750 | 750 × 750 |
| **Duration** | ≤ **3.0 s** | ≤ **5.0 s** | ≤ **6.0 s** |
| **File size** | ≤ **500 KB** | ≤ **1 MB** ⚠️ | ≤ **1 MB** ⚠️ |
| **Frame rate** | 30 fps comp | 30 fps comp | 30 fps comp |
| **Loop** | Off | Off | Off |

- **Square canvas, rendered centred with `contain`.** It plays the same on every phone
  shape; a portrait canvas would crop or letterbox differently per device.
- **Transparent background.** The room shows through.
- **Durations are enforced.** The gift queue schedules around these numbers
  (`theme/tokens.ts`), and `GiftAnimation` kills anything still running at **8 s**. An
  animation that overruns is cut off mid-flight in front of the person who paid for it.
- ⚠️ **The 1 MB budget for Tiers 4–5 relaxes the earlier 500 KB rule** (migration 005,
  `CLAUDE.md`). Reasoning: the glossy premium look needs embedded raster sprites (see
  below), these five gifts are rare, and `assets.ts` only preloads them on Wi-Fi. Tier 3
  keeps 500 KB because it is sent far more often. **Agree or reject this before briefing.**

### What Lottie can and cannot do on phones

Verified against Airbnb's own support table (`airbnb/lottie` · `supported-features.md`)
for **Android and iOS both** — anything that works on only one is treated as unsupported.

**Never use — broken or missing on at least one platform:**

| Feature | Problem |
|---|---|
| Expressions | Unsupported on Android and iOS |
| Merge paths | Unsupported on iOS |
| Gaussian blur | Unsupported on iOS |
| Glow, Fill, Stroke, Tint, Tritone, Levels effects | Unsupported on both |
| Luma mattes (and inverted) | Unsupported on both — use **alpha** mattes |
| Mask modes: Lighten, Darken, Difference, Expansion, **Feather** | Unsupported on both |
| Auto-orient | Unsupported on both |
| Trim paths applied simultaneously | Unsupported on iOS (Core Animation) |
| **Any text layer** | Text features are patchy, **and** names must render in the user's language and script. The app draws all text. |

**Allowed, with care:**

| Feature | Rule |
|---|---|
| **Embedded raster images** | Supported everywhere, and usually **necessary** for the glossy 3D look — pre-render the object as a sprite and animate its transforms. Embed as WebP where possible; every sprite counts against the budget. Base64 embedding inflates size by about a third. |
| **Glow and light rays** | Build with **radial gradients** or a pre-rendered glow sprite, never the Glow or blur effect. |
| **Drop shadows** | Supported, but Android applies them per shape rather than per layer — keep them on single-shape layers and pad precomps so shadows are not clipped. |
| Alpha mattes, gradients (linear/radial), precomps, time remap, repeaters | Supported. |

Anything not in that table: prove it on a real Android and a real iPhone before it goes
into a delivery.

---

## 4 · Avatar frames

A cosmetic drawn **over** the avatar, larger than it, so ornament can extend past the
circle. Implemented in `ui/Avatar.tsx` as `FRAME_SCALE = 1.36`.

| | |
|---|---|
| **Canvas** | **400 × 400 px**, transparent |
| **Avatar hole** | A circle of **294 px diameter**, centred (400 ÷ 1.36). The face shows through it. |
| **Inside the hole** | Fully transparent. Ornament may intrude inward by **no more than ~18 px** at the edge — anything more covers faces. |
| **Budget** | ≤ **60 KB** |
| **Motion** | **Static.** A frame appears on every avatar in every list; animated frames in a scrolling feed are a performance cost paid on every row. |

The derivation, so it survives a size change: the largest avatar is `xl` = 96 pt → 288 px
at @3x → × 1.36 = 392 px, rounded to a 400 px canvas.

---

## 5 · Entry effects

The banner that announces a user entering a room.

| | |
|---|---|
| **Format** | Lottie JSON |
| **Canvas** | **750 × 250 px** (3:1), transparent |
| **Name slot** | The app draws the username. Keep the rectangle **x 260–720, y 95–155** clear of anything the text would collide with. |
| **Duration** | ≤ **2.5 s**, loop off |
| **Budget** | ≤ **300 KB** |
| **Rules** | Everything in §3's Lottie table applies. **No text layers** — the name is dynamic and may be Hindi. |

---

## 6 · Style data, not images

Three cosmetics are **data**, never artwork.

**Chat bubbles.** React Native's nine-slice stretching (`capInsets`) is **iOS-only**, so a
stretchable bubble image cannot work on Android — Android-first is the launch plan. A
bubble is a style instead:

```json
{ "background": ["#FFD86B", "#F59E0B"], "border": "#B45309", "borderWidth": 1.5,
  "text": "#1C1917", "cornerOrnament": "badges/bubble-crown.v1.webp" }
```

`cornerOrnament` is optional: a small static WebP pinned to a corner, **≤ 72 × 72 px**,
≤ 15 KB — never stretched.

**Nickname colours.** Two to three gradient stops. No asset.

**Super messages.** A style record like a chat bubble, plus an optional entry Lottie
following §5.

---

## 7 · Badges

| | |
|---|---|
| **VIP badges** | WebP, **162 × 54 px** (54 × 18 pt @3x), transparent, ≤ 20 KB |
| **Level badges** | **No asset.** Drawn in code (`visuals/LevelBadge.tsx`) on the gift-tier colour ramp. |
| **Promotional banners** | **No asset.** Drawn in code from a server-named theme (`gold`, `rose`, `violet`); the client owns the palette. |

---

## 8 · Placeholders

What the app runs on until real art arrives.

| Asset | Placeholder | Licence |
|---|---|---|
| Gift icons (18) | **Microsoft Fluent Emoji 3D** | MIT |
| Laddu, Perfume icons | Fluent 3D *wrapped gift* 🎁 — neither exists as an emoji anywhere | MIT |
| Tier 3–5 animations | **Google Noto Animated Emoji**, closest match per gift | CC BY 4.0 |
| One heavy stand-in | A LottieFiles free animation near the **1 MB** budget | Lottie Simple License |
| Frames | A plain ring drawn **exactly** to the §4 canvas and hole | Ours |

**Placeholders must behave like the real thing.** Noto animations are small — tens of
kilobytes — and will never expose the dropped frames a budget-sized real animation will
on a low-end Android. The heavy stand-in exists purely so performance is tested at the
size the real art will be.

**Placeholders must never ship.** Every placeholder lives under a `placeholder/` path
prefix, and production refuses any active catalog or cosmetic row pointing there (see §10).

---

## 9 · Accepting a delivery

An asset is not done until all of these pass:

- [ ] Canvas, safe area and budget match this document exactly
- [ ] Transparent where it should be — checked on a dark **and** a light background
- [ ] Lottie: nothing from the §3 *never use* table. Effects are visible in the JSON as `"ef"` arrays on layers; for expressions, get the designer's written confirmation — the real-device check below is what catches anything missed
- [ ] Lottie: plays correctly on a **real Android** and a **real iPhone**, not just the LottieFiles web preview
- [ ] Lottie: no dropped frames on a **low-end Android** in a live room
- [ ] Duration within its tier's limit
- [ ] Uploaded at a **new** versioned path — nothing overwritten
- [ ] Source file (`.aep` / `.psd` / `.blend`) received and stored
- [ ] Rights holder recorded

---

## 10 · What the functional phase must build

The contract is only half the swap. These are code, not art, and belong before any real
asset arrives.

| Gap | State |
|---|---|
| **`icon_asset` on the gift catalog** | ✅ Done in M6 — migration `015`, the catalog API, the client type, and `visuals/GiftIcon.tsx` with its fallback. |
| **Cosmetics API returns `asset`** | Open — M7. The `cosmetics.asset` column exists but `listCosmetics` never selects it. |
| **Tier 1–2 `animation_asset`** | ✅ Done in M6 — set to `NULL`, and a CHECK constraint keeps `basic` gifts from ever getting one. |
| **Mount `GiftAnimationLayer` in the room** | ✅ Done in M6. |
| **Versioned paths** | ✅ Done in M6 for gifts: `placeholder/gifts/{id}/icon.v1.webp` and `anim.v1.json`. |
| **Placeholder guard** | ✅ Done in M6 — reconciliation check `no_placeholder_assets_live`, production only. |
| **Stand-in files uploaded** | Open. The paths exist; the Fluent and Noto files behind them do not, so the app shows its fallbacks. |
| **Entry effects, chat-bubble styles, VIP badges** | Open — M7. |
