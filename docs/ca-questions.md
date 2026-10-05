# Questions for the CA

Open tax and accounting questions for Dhunlive Private Limited. Record answers
here as they come back, with the date. Items marked **BLOCKS CODE** are holding
up M8 (host payouts).

---

## Context to give the CA first


Users buy **coins** with real money — in-app purchase, a web portal, or from an
approved agency. They spend coins on virtual gifts to hosts. Hosts earn
**points**, which they withdraw as rupees. The platform keeps the spread.

The rates:

| | |
|---|---|
| What a user gets | 110 coins per ₹1 |
| Accounting face value | 130 coins = ₹1 (deferred revenue only) |
| What a host earns | 60% of the gift's coin count, as points |
| Point value | 260 points = ₹1 |
| Real payout | ~30% of what the user paid |

So an advertised 60% split pays out about 30% in cash, because a point is worth
half a coin.

**Coins are held as a liability. Revenue is recognised only when a coin is
SPENT**, not when it is bought.

**Agencies** buy coins wholesale (124–140 coins per ₹1, by volume) and resell
them to users off-platform — we never see that money. Separately, an agency
earns 4–20% commission on its hosts' earnings, paid by us as points the agency
withdraws itself.

Hosts withdraw from ₹1,000 in ₹1,000 steps; agencies from ₹2,000. Earnings are
held 7 days (14 for a new host) before they can be withdrawn.

---

## 1. GST

The biggest commercial question. Q1 and Q5 affect pricing.

1. **When is GST payable — when a user buys coins, or when the coin is spent on
   a gift?** Our books recognise revenue on spend. If GST falls due at purchase,
   the two diverge and we must track both from day one.
2. **Are coins a "voucher" under GST?** If so, the time-of-supply rules for
   vouchers apply and may answer Q1. Is this worth an advance ruling?
3. **What rate and SAC code** for virtual gifts and cosmetic items?
4. **For Play Store and App Store sales, who is the supplier to the end user —
   us or the store?** And is the store's commission an import of service
   attracting reverse charge?
5. **Is our financial model missing GST entirely?** It currently models store
   fees but has no GST line. If 18% applies on gross coin sales, the margin
   assumptions change materially. Tell us what to model.
6. **Input tax credit** on cloud, media-server and payment-gateway costs —
   anything blocked?
7. **Registration** — single state or multiple, and at what threshold?

**Answer:**

---

## 2. TDS on host payouts — BLOCKS CODE

8. **Which section applies: 194J or 194-O?** We think we are an e-commerce
   operator facilitating hosts' supply to users, which reads like 194-O. **We
   need this in writing**, with the rate and threshold.
9. **If 194-O, what is the base** — the gross gift value the user paid, or the
   host's ~30% share? This changes the withholding several times over.
10. **Deduct at credit or at payment?** Points are credited continuously as
    gifts arrive, but paid monthly. "Credit or payment, whichever is earlier"
    would mean withholding at credit, which is operationally very different. We
    need this before we build the pipeline.
11. **Crossing the threshold** — we plan to withhold on the full year-to-date
    amount once crossed, not just the excess. Confirm.
12. **No PAN** — 206AA at 20%? Our rule is that no payout happens without a
    verified PAN, so confirm that is sufficient.
13. **Financial-year accumulator** per host, April–March — confirm the boundary
    and tell us what you need exported.

**Answer:**

---

## 3. TDS on agency commission

14. **194H or 194J**, and at what rate? Agencies will be firms and companies,
    not only individuals.
15. An agency is both our **customer** (buying coins) and our **service
    provider** (earning commission). We keep the two entirely separate and never
    net one against the other. Confirm that is correct and raises no set-off
    issue.

**Answer:**

---

## 4. The agency channel

16. We sell coins to an agency at a discount; they resell at their own price,
    off-platform, and collect from users directly. **Does any part of their
    margin or their collection become our revenue or our TDS obligation?** We
    say no.
17. **TCS under 206C(1H)** on sale of goods above ₹50 lakh to one buyer — does
    an agency buying coins in bulk trigger it?

**Answer:**

---

## 5. Revenue recognition and coin float

18. **Is unspent coin float a liability until the coin is spent?** That is our
    assumption and the entire ledger is built on it.
19. **Breakage** — do we ever recognise coins that are never spent, and when? We
    plan to forfeit after 24 months of inactivity.
20. **Is there unclaimed-property or escheat exposure** in India on forfeited
    balances?
21. **Which standard — AS or Ind AS** for a private limited at our stage?

**Answer:**

---

## 6. Losses, reversals and value in kind

22. **Chargeback after the coins are already spent.** The platform bears the
    loss and never claws back from the host. Is that a deductible business loss?
23. **Ban forfeiture** — we forfeit a banned user's coin balance. Revenue, or
    write-back of a liability?
24. **Points converted back into coins.** A host turns earned points into coins
    to spend in the app; no cash leaves. We assume no TDS at that moment because
    the income arose when the points were credited. Confirm — and is the
    conversion itself a taxable supply to the host?
25. **Seeding guarantees** — a guaranteed minimum earning of about ₹15,000/month
    for early hosts. Same TDS treatment as ordinary earnings, or different?

**Answer:**

---

## 7. Classification risk

26. Hosts set their own hours, have no exclusivity, and are paid purely on what
    they earn. We never use the word "salary". **Confirm no PF, ESI or gratuity
    exposure** — and say if you would rather labour counsel answered this.

**Answer:**

---

## Priority

| Items | Why |
|---|---|
| 8, 9, 10 | Block the payout pipeline (M8) |
| 1, 5 | Affect pricing and the margin model |
| Everything else | Can be carried as an assumption until launch |
