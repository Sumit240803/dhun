# Asset list — everything that needs to be drawn

The complete order, taken from the live catalog (`gifts`, `cosmetics`) on 2026-10-06.
Specs are the binding ones from `docs/asset-contract.md`; this file is the quantity and
the names, that file is the technical appendix every brief must carry.

**Totals: 46 files.**

| Batch | Files | Format |
|---|---|---|
| Gift icons | 20 | WebP 256×256 |
| Gift animations (tiers 3–5 only) | 10 | Lottie JSON 750×750 |
| Avatar frames | 3 | WebP 400×400, static |
| Entry effects | 2 | Lottie JSON 750×250 |
| VIP badges | 4 | WebP 162×54 |
| Super message badge | 1 | WebP 162×54 |
| Chat bubbles | 0 | **style data, not art** |
| Nickname colours | 0 | **style data, not art** |
| Level badges, promo banners | 0 | drawn in code |

Chat bubbles and nickname colours are deliberately **not** on the list: Android cannot
stretch a nine-slice bubble image (`capInsets` is iOS-only) and Android is the launch
platform, so a bubble is three colours per palette in `cosmetics.style`. Same for
nickname colours. Nothing to draw — only hex values to choose, both light and dark.

---

## 1 · Gift icons — 20 files

`gifts/{giftId}/icon.v1.webp` · 256×256 transparent · subject inside 216×216 · ≤30 KB ·
**one art direction across all 20**, one key light upper-left. The gift sheet shows every
tier side by side and one mismatched icon makes the whole grid look cheap.

### Tier 1 — Impulse (icon only, no animation)

| id | Name | Coins | ≈₹ |
|---|---|---|---|
| `heart` | Heart | 20 | 0.18 |
| `rose` | Rose | 90 | 0.82 |
| `candy` | Candy | 170 | 1.55 |
| `balloon` | Balloon | 330 | 3.00 |
| `clap` | Clap | 520 | 4.73 |

### Tier 2 — Regular (icon only, no animation)

| id | Name | Coins | ≈₹ |
|---|---|---|---|
| `perfume` | Perfume | 999 | 9.08 |
| `teddy` | Teddy | 1,998 | 18.16 |
| `guitar` | Guitar | 2,500 | 22.73 |
| `cake` | Cake | 3,300 | 30.00 |
| `bouquet` | Bouquet | 4,400 | 40.00 |

### Tier 3 — Statement (icon + full-screen animation)

| id | Name | Coins | ≈₹ |
|---|---|---|---|
| `scooter` | Scooter | 6,600 | 60 |
| `fireworks` | Fireworks | 8,300 | 75 |
| `motorbike` | Motorbike | 13,200 | 120 |
| `diamond_ring` | Diamond ring | 19,800 | 180 |
| `yacht` | Yacht | 31,000 | 282 |

### Tier 4 — Flex (icon + room-banner animation)

| id | Name | Coins | ≈₹ |
|---|---|---|---|
| `sports_car` | Sports car | 90,000 | 818 |
| `private_jet` | Private jet | 165,000 | 1,500 |
| `castle` | Castle | 290,000 | 2,636 |

### Tier 5 — Global (icon + all-rooms animation)

| id | Name | Coins | ≈₹ |
|---|---|---|---|
| `rocket` | Rocket | 800,000 | 7,273 |
| `galaxy` | Galaxy | 1,650,000 | 15,000 |

---

## 2 · Gift animations — 10 files

`gifts/{giftId}/anim.v1.json` · Lottie from After Effects/Bodymovin · 750×750 square,
transparent, 30 fps comp, **loop off**.

| Tier | Gifts | Duration | File size |
|---|---|---|---|
| 3 | scooter, fireworks, motorbike, diamond_ring, yacht | ≤ 3.0 s | ≤ 500 KB |
| 4 | sports_car, private_jet, castle | ≤ 5.0 s | ≤ 1 MB ⚠️ |
| 5 | rocket, galaxy | ≤ 6.0 s | ≤ 1 MB ⚠️ |

**Ten, not twenty.** Tiers 1–2 are `basic` effect — the full-screen layer skips them by
design and the gift strip is their whole display. Commissioning animations for them pays
for art no user ever sees.

**Durations are enforced in code.** `GiftAnimation` kills anything still running at 8 s,
and the queue schedules around the numbers above. An overrunning animation is cut off
mid-flight in front of the person who just paid ₹15,000.

**Lottie restrictions are not negotiable** — no expressions, no merge paths, no blur, no
Glow/Fill/Stroke/Tint effects, no luma mattes, no feather, no auto-orient, **no text
layers at all**. Glows are radial gradients or pre-rendered sprites. Embedded raster
sprites are allowed and usually necessary for the glossy 3D look. The full table, verified
against Airbnb's own Android+iOS support matrix, is §3 of the asset contract and must go
out with every brief.

---

## 3 · Avatar frames — 3 files

`frames/{cosmeticId}.v1.webp` · 400×400 transparent · **static** · ≤60 KB · centred
transparent hole 294 px diameter, ornament may intrude inward ≤18 px.

| cosmeticId | Name | Gems | How it is obtained |
|---|---|---|---|
| `frame_basic` | Basic frame | 6,500 | also **free at level 31** |
| `frame_rose` | Rose frame | 6,500 | purchase, 30 days |
| `frame_ocean` | Ocean frame | 6,500 | purchase, 30 days |

Static on purpose: a frame is drawn on every avatar in every list, so an animated one is
a performance cost paid on every scrolling row.

Each also needs a **ring colour** for `cosmetics.style` — the frame's dominant colour,
light and dark variants — drawn in code until the art loads, and instead of it on a bad
connection. A frame someone paid for is never simply invisible.

---

## 4 · Entry effects — 2 files

`entry/{cosmeticId}.v1.json` · Lottie · 750×250 (3:1) transparent · ≤2.5 s, loop off ·
≤300 KB · **keep the rectangle x 260–720, y 95–155 clear** — the app draws the username
there, and it may be Hindi.

| cosmeticId | Name | Gems | How it is obtained |
|---|---|---|---|
| `entry_basic` | Basic entry | 13,000 | also **free at level 16** |
| `entry_premium` | Premium entry | 52,000 | purchase, 30 days |

No text layers. Each also needs an `accent` colour per palette for the code-drawn banner.

---

## 5 · Badges — 5 files

`badges/{id}.v1.webp` · 162×54 px (54×18 pt @3x) transparent · ≤20 KB.

| cosmeticId | Name | Gems | Status |
|---|---|---|---|
| `vip_silver` | VIP Silver | 13,000 | catalog row exists, **inactive** |
| `vip_gold` | VIP Gold | 65,000 | inactive |
| `vip_platinum` | VIP Platinum | 260,000 | inactive |
| `vip_diamond` | VIP Diamond | 1,300,000 | inactive |
| `super_message` | Super message | 10,400 | inactive |

These five are not sold yet — VIP and super messages are unbuilt features. Their rows and
prices exist, so the art can be commissioned in the same batch at no extra brief, but
nothing breaks if they come later.

**Level badges and promotional banners need no asset.** Level badges are drawn in code
(`visuals/LevelBadge.tsx`) on the gift-tier colour ramp; promo banners are drawn from a
server-named theme (`gold`, `rose`, `violet`) with the client owning the palette.

---

## 6 · Nickname colours and chat bubbles — 0 files, 4 decisions

Nothing to draw, but someone has to pick the colours. Each needs a light and a dark
variant, `#RRGGBB` only, validated by `backend/src/shared/cosmeticStyle.ts`.

| cosmeticId | Kind | Gems | What it needs |
|---|---|---|---|
| `nickname_rose` | nickname colour | 2,600 | `{light:{color}, dark:{color}}` |
| `nickname_teal` | nickname colour | 2,600 | same |
| `bubble_rose` | chat bubble | 3,900 | `{light:{background,border,text}, dark:{…}}` |
| `bubble_night` | chat bubble | 3,900 | same |

Check `text` against `background` for contrast in **both** variants — a colour chosen for
white is often unreadable on dark, and over the room stage the app always draws `dark`.

A nickname colour is a **solid** colour today. Gradient names need masked text, which the
app does not ship yet; stops can be added to the schema when it does.

---

## 7 · Delivery rules that apply to every file

- **Paths are immutable.** New art gets `v2`, never an overwrite. The client caches
  forever on that assumption, so replacing a file at the same path leaves some users on
  the old art indefinitely.
- **Nothing is bundled into the app.** The catalog stores the path, the app resolves it
  against the CDN (`EXPO_PUBLIC_ASSET_URL`, `visuals/assets.ts`). Swapping art is an
  upload plus a catalog row — no app release. Day-1 non-negotiable #6.
- **Static art is delivered at @3x** of its largest on-screen size, WebP, transparent,
  sRGB. PNG only if a tool cannot export WebP.
- **Source files are part of the delivery.** `.aep`, `.psd`, `.blend`, stored outside the
  app repo. The source is what keeps the Lottie decision reversible; without it we are
  locked to the format forever.
- **Every asset has a recorded rights holder.** Nothing extracted from another app, ever,
  not even as a temporary placeholder.

---

## Two things to decide before briefing anyone

1. **The 1 MB budget for tiers 4–5.** It relaxes the earlier 500 KB rule, on the grounds
   that the glossy premium look needs embedded raster sprites, these five gifts are rare,
   and `assets.ts` only preloads them on Wi-Fi. Tier 3 stays at 500 KB because it is sent
   far more often. **Agree or reject it now** — it changes what the animator can build.
2. **No marketplace sells gift animations in a format this app can render.** The
   marketplace search found Lottie packs for UI motion, and plenty of SVGA/PAG gift packs
   built for native Android/iOS apps, which React Native cannot play. Tiers 3–5 have to be
   commissioned to §2 above. Icons, frames and badges are static WebP and can come from a
   marketplace or an illustrator, provided all 20 icons come from **one** hand.
