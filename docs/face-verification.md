# Face verification — how to build it

**DECIDED 2026-10-16, and built.** This document is the research that led there; the
decision is below and the build is M17 in `docs/build-plan.md`.

| | What ships |
|---|---|
| **Onboarding, once** | Phone OTP (already built) **+ a face photo reviewed by a human** in the admin panel. No vendor. At 30–50 hosts a person is more accurate than any API and costs nothing — and it is the pair China's NRTA directive requires, "facial recognition **and manual review**". |
| **Every go-live** | A selfie is **captured and queued**. **Nothing is gated.** A moderator reviews it afterwards and can flag, end the room, or suspend the host. |

**Why nothing is gated.** A gate fails on real hosts — bad light, glasses, a cheap front
camera — and every false reject is a host who cannot earn, in a category where host supply
is the thing most likely to kill the product. What makes an hour-late catch good enough is
the **payout hold**: earnings sit 7–14 days before withdrawal, so a handoff caught within a
day is caught long before money leaves. Suspension stops future earning; the hold stops past
earning from leaving.

**And it meant no new native dependency.** Without liveness there are no frame processors,
so no `react-native-vision-camera`, no ML Kit — `expo-image-picker`, already installed,
takes the photo.

**When review stops scaling** (a few hundred hosts), the liveness gate from §4 earns its
place as a free on-device filter so humans only see ambiguous frames. The research below is
what that decision will be made from.

---

Two things get called "face scan" and they are different problems with different
costs. Separating them is the whole design.

---

## 1 · What already exists

**Mobile number verification is built.** Phone OTP behind a provider interface —
`console` in dev, `msg91` in production once DLT clears. Nothing to do there.

**Face is entirely new.** The app has `expo-image-picker` and no camera package at
all, so this is a new native dependency as well as new code.

**It is already required.** Hard rule #5: *"18+ only. PAN + face match mandatory
before any payout."* M8 cannot ship without the onboarding half of this, so one
integration serves both purposes.

---

## 2 · Two problems, not one

| | Onboarding (in the profile) | Every time they go live |
|---|---|---|
| **Question it answers** | Is this a real adult whose face matches their PAN? | Is the person starting this room the person we verified? |
| **What it defends against** | A minor host · a fake identity · a payout to the wrong person | **Account handoff** — a verified adult's account used by somebody else |
| **How often** | Once per host, ever | Every stream |
| **Needs** | Face match + liveness + document OCR | **Liveness, and sometimes a match** |
| **Tolerable friction** | 60 seconds | **2 seconds** |

The second one is the interesting problem, and it is the one that decides the
architecture — because of what it costs.

---

## 3 · The cost, which decides everything

Indian KYC vendors (HyperVerge, Signzy, IDfy, Digio) all price per check. Published
figures are scarce — all four are sales-led — but the range from secondary sources is
**₹2–10 per face match + liveness**, with one competitor's listing putting HyperVerge
at about $0.20 (≈₹17) per unit.

**Onboarding is trivially affordable.** 50 hosts × ~₹30 for a full PAN + face + liveness
journey = **₹1,500, once.** Even at 1,000 hosts it is ₹30,000 one-off.

**A vendor call on every go-live is not:**

```
  50 hosts × 3 streams/day × 30 days  =  4,500 checks/month
  × ₹2–10                             =  ₹9,000–45,000 / month
```

Against a **₹14,400/month infrastructure budget**, the cheap end is most of it and the
expensive end is three times it. At 500 hosts it is ₹90,000–450,000 a month and the
feature is simply unaffordable.

**So the recurring check cannot be a vendor API call.** That constraint produces the
design below.

---

## 4 · The design: split liveness from matching

They answer different questions and cost different amounts.

| | Liveness | Match |
|---|---|---|
| **Asks** | Is this a live human in front of the camera right now? | Is it *this particular* human? |
| **Beats** | A photo, a screen, a looping video | Account handoff |
| **Runs** | **On device, free** | Server-side, costs money |
| **Takes** | ~2 seconds | ~1 second |

**Run liveness every single time. Run the match on a rule.**

The host's experience is identical either way — they do a face scan before going live,
every time. What differs is whether that scan is compared against their reference on
every occasion or on a schedule.

### The rule I would start with

Match when any of these is true, liveness-only otherwise:

- **First stream on a new device**, ever
- **More than 24 hours** since the last successful match
- **A moderation flag** is open on the account
- **Randomly, ~10% of the time**, so the check cannot be predicted and waited out

```
  50 hosts × ~1.3 matches/day × 30  ≈  2,000 checks/month
  × ₹2–10                           =  ₹4,000–20,000 / month
```

Roughly half to a quarter of the naive cost, and it still catches a handed-off account
within a day — while the liveness check catches a photo or a replayed video *instantly,
every time, for free*.

**If you want a true match on every stream**, the only affordable route is a
self-hosted embedding model (MobileFaceNet or ArcFace via ONNX Runtime, ~5 MB, ~50 ms
on CPU). Free per call after the setup, and it adds ML operations a solo founder does
not currently have. I would not start there — but it is the escape hatch if the sampled
rule proves insufficient, and the provider interface below makes the swap a one-file
change.

---

## 5 · Mobile

**`expo-camera` cannot do this.** It has no frame processors, so there is no way to run
ML on the live camera feed. Liveness needs **`react-native-vision-camera`** plus an ML
Kit face-detection frame processor.

That is a new native dependency, but **not a blocker** — the app is already on the Expo
prebuild (CNG) workflow for LiveKit and WebRTC, which is exactly what this needs.

### What ML Kit gives you per frame

- left and right **eye-open probability**
- **head pose angles** (yaw, pitch, roll)
- **smiling probability**
- a bounding box and a **stable tracking ID across frames**

The tracking ID is the important one: it is what proves the same face was present for
the whole challenge, rather than one face being swapped for another mid-check.

### The challenge

Pick two at random from: **blink · turn left · turn right · smile**, in a random order,
with a 10-second budget. Random order is what stops a pre-recorded video passing — the
attacker cannot know which gesture comes next.

Capture one frame at the end for the match step, when one is needed.

### Where it goes

```
features/verification/
  useLivenessCheck.ts    the challenge state machine, pure and testable
  LivenessScreen.tsx     the camera, the prompt, the progress
  liveness.ts            ML Kit behind a guard, like features/room/livekit.ts
```

The ML Kit loader follows `livekit.ts` exactly: a build without the native module
degrades to a stated failure, never a red screen.

---

## 6 · Backend

### Provider interface, like everything else vendor-shaped

`RtcProvider`, `iapVerifier` and `MediaProvider` all exist so a vendor can be replaced
without touching the modules that use it. Face verification is the most vendor-locked
thing in the product and gets the same treatment:

```
modules/verification/
  index.ts                 the public API
  provider.ts              interface + a `console` stub for dev
  hyperverge.provider.ts   (or signzy / idfy — one file each)
  verification.service.ts  the rules: when to match, what a failure means
  verification.routes.ts
```

A `console` provider that always passes is what lets the whole flow be developed and
tested without a vendor account — the same pattern as the IAP stub and the OTP console
provider, and it is why those were buildable before incorporation.

### Schema

```sql
host_verifications      -- the onboarding record: status, PAN last4, verified_at,
                        -- the provider's reference id. NEVER the document image.
face_checks             -- one row per go-live attempt: result, mode (liveness |
                        -- match), score, device, at. The audit trail.
```

**Store a template reference, never photographs.** Ideally the vendor holds the
reference face and returns only a score — then the biometric never lands in our
database at all, which is the strongest position under §8.

### Where the gate goes

`goLive` in `rooms/live.service.ts`, which already refuses an unverified-adult host and
already rejects a second live room. One more precondition, same place.

The check happens **before** the room row is written, so a failed scan leaves nothing
behind.

---

## 7 · The part most people get wrong: what happens when it fails

A face check will fail on bad light, a new beard, glasses, a cheap front camera, a
host in a dark room — which is most hosts, most evenings. **This is a host's income.**
Getting the failure path wrong costs you the host supply you spent months recruiting.

Non-negotiables:

1. **Three attempts, then a fallback — never a hard stop.** Offer a retry with a hint
   ("more light on your face"), then a manual review queue.
2. **A liveness failure is not a match failure.** "We couldn't see you clearly" and
   "you are not the person on this account" are different messages and different
   consequences. Never show the second when you mean the first.
3. **Failures are logged and reviewable, not silently counted.** A host repeatedly
   failing is either a camera problem or a handed-off account, and only a human can
   tell which.
4. **Never lock the account on a failed check.** Block the stream, not the account.
   Suspension is a moderation decision with an appeal, not an automated one.
5. **A provider outage must not stop every host going live.** When the vendor is down,
   fall back to liveness-only and flag the session for review. A broken vendor taking
   the whole platform offline on a Saturday evening is a worse outcome than a few
   unmatched streams.

---

## 8 · DPDP

The DPDP Rules were notified in November 2025, with substantive obligations enforceable
by **13 May 2027** (one proposal would bring that to late 2026 — not confirmed).

What it means here:

- **Consent must be specific and unambiguous**, by clear affirmative action, and
  withdrawal must be as easy as giving it. A tick-box buried in the host agreement is
  not consent to a biometric scan.
- **Delete when the purpose is fulfilled.** A host who leaves and deletes their account
  should have their face data deleted with it — which fits our existing rule that
  account deletion anonymises rather than removes the ledger row.
- **Encryption in transit and at rest, with access logging.**
- **Processing biometrics at scale is named as a likely trigger for Significant Data
  Fiduciary designation**, which carries extra duties (a Data Protection Officer, audits,
  impact assessments). At 50 hosts this is remote; it is worth knowing it exists before
  the host count has three digits.

**The strongest design is the one where we never hold the biometric at all** — the
vendor stores the reference, we store their reference id and a score. Worth making it an
explicit requirement when you ask for quotes.

Sources disagree on whether the Act treats biometric data as a separate sensitive
category — it has no GDPR Article 9 equivalent, and takes a principles-based approach
instead. **Put it to the lawyer alongside the gaming-law opinion**, not to me.

---

## 9 · What I would build, in order

| | What | Blocked on |
|---|---|---|
| **1** | The `verification` module with a **`console` provider** that always passes, the schema, and the `goLive` gate | nothing |
| **2** | **On-device liveness** — vision-camera, ML Kit, the challenge screen, the failure paths | nothing |
| **3** | The match rule (new device / 24h / flagged / 10% sample) against the stub | nothing |
| **4** | A real vendor provider | a vendor account, which wants the company to exist |
| **5** | Onboarding PAN + face match, with M8 | CA, RazorpayX, the same vendor |

**Steps 1–3 are buildable today** and are most of the work. That is the same shape as
IAP and OTP: build against a stub, swap the provider in when the account exists.

---

## 10 · What needs your decision

1. **Match on every stream, or on the rule in §4?** The rule is 2–4× cheaper and the
   host cannot tell the difference. I recommend the rule; it is a config dial either way.
2. **Which vendor.** Get quotes from HyperVerge, Signzy, IDfy and Digio for: per-check
   face match, per-check liveness, and a full PAN + face onboarding journey — and ask
   each **whether they can hold the reference face so we never store it**.
3. **Does the in-house seeded agency's hosts get the same treatment?** They are our own
   30–50 hosts. I would say yes, without exception — the one account you exempt is the
   one that embarrasses you.
4. **Non-host users: no face check at all?** The references only scan hosts. Viewers
   spend money but never appear on camera, so there is nothing to impersonate.

---

**Sources:** [HyperVerge pricing commentary](https://hypersign.id/resources/blog/hyperverge-pricing-india-2026) · [IDfy review](https://productgrowth.in/tools/kyc-identity/idfy/) · [Real-time face liveness in React Native](https://dev.to/d33n/real-time-face-liveness-in-react-native-vision-camera-worklets-and-ml-kit-2bne) · [VisionCamera vs Expo Camera](https://www.pkgpulse.com/guides/react-native-vision-camera-vs-expo-camera-vs-expo-image-2026) · [DPDP Rules 2025 (PIB)](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf) · [DPDP compliance guide](https://standardful.com/blog/india-dpdp-act-2026-compliance-guide)
