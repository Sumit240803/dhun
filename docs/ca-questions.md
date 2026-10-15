# Questions for the CA

**Dhunlive Private Limited — Dhun**

---

## The brief

We are building **Dhun**, an India-first live-streaming and voice party-room app.
Pre-revenue, pre-incorporation, launching Android-first in one region.

**How the money moves, in one line:** a user buys **coins** with real money → spends
them on virtual **gifts** to a host → the host earns **points** → the host withdraws
points as rupees to their own bank account. We keep the spread.

Five facts that shape most of the questions:

1. **Coins are bought in packs**, at roughly 110 coins per ₹1. Some coins are also
   given away free for signing up and daily check-ins.
2. **A gift pays the host about 30% of what the user paid**, in points. Points convert
   to rupees at a fixed rate held in config.
3. **We assume unspent coins are a liability, not revenue.** Revenue is recognised when
   a coin is *spent* on a gift. Our entire double-entry ledger is built on that
   assumption.
4. **Agencies are a second sales channel.** An approved agency pays us up front for a
   block of coins at a wholesale discount, then resells those coins to users at its own
   price, collecting from them directly and off-platform. The agency also earns a
   commission on what its hosts earn.
5. **We pay every party directly.** Hosts, sub-agents and agencies each withdraw their
   own earnings from us to their own bank account. No one's earnings ever pass through
   anybody else — deliberately, to avoid becoming a payment aggregator.

Hosts set their own hours, hold no exclusivity, and are paid only on what they earn. We
never use the word "salary".

**What we need most urgently:** questions 1, 2 and 8–10. They block the payout code we
are about to write, and we would rather build it once.

---

## 1 · GST — the biggest commercial unknown

1. Is GST payable when a user **buys** coins, or when the coin is **spent** on a gift?
2. Are coins a **voucher** under GST, and do the voucher time-of-supply rules therefore
   answer question 1? Is this worth an advance ruling?
3. What rate and SAC code apply to virtual gifts and to cosmetic items?
4. On Play Store and App Store sales, who is the supplier to the end user — us or the
   store? Is the store's commission an import of service attracting reverse charge?
5. Does OIDAR apply to us as a domestic provider, or is it only relevant to foreign
   competitors selling into India?
6. Our financial model currently has **no GST line at all**. If 18% applies on gross
   coin sales, what should we model?
7. Is input tax credit available on cloud hosting, media servers and payment-gateway
   fees, or is any of it blocked?
8. Do we register in one state or several, and at what threshold?

---

## 2 · TDS on host payouts — this blocks code

9. Which section applies, **194J or 194-O**? We believe we are an e-commerce operator
   facilitating the host's supply to the user, which reads like 194-O. We need the
   section, rate and threshold in writing.
10. If 194-O applies, what is the base — the **gross** gift value the user paid, or the
    host's ~30% share?
11. Do we deduct at **credit or at payment**? Points are credited continuously as gifts
    arrive but paid out monthly, so "whichever is earlier" would mean withholding at
    credit. That is a very different pipeline.
12. Once a host crosses the annual threshold, do we withhold on the **full year-to-date
    amount** or only on the excess?
13. If a host has no PAN, is it 20% under 206AA? Our rule is that no payout happens at
    all without a verified PAN — is that sufficient?
14. We will keep a per-host financial-year accumulator, April to March. What do you need
    us to export, and in what format, for your 26Q filings and Form 16A?

---

## 3 · TDS on agency and sub-agent commission

15. Is agency commission **194H or 194J**, and at what rate? Agencies will be firms and
    companies, not only individuals.
16. An agency is simultaneously our **customer** (it buys coins) and our **service
    provider** (it earns commission). We keep the two entirely separate and never net
    one against the other. Is that correct, and does it raise any set-off issue?

---

## 4 · The agency sales channel

17. We sell coins to an agency at a discount. It resells them at its own price,
    off-platform, and collects from users directly. Does any part of that margin or that
    collection become **our** revenue or **our** TDS obligation? We believe not.
18. Does **TCS under 206C(1H)** apply when an agency buys more than ₹50 lakh of coins
    from us in a year?
19. Is the sale of a block of coins to an agency a supply of goods, a supply of
    services, or a voucher — and when does GST fall due on it?

---

## 5 · Revenue recognition and the coin float

20. Is unspent coin float a **liability** until the coin is spent? This is our core
    assumption.
21. **Breakage** — may we ever recognise coins that are never spent, and when? We plan
    to forfeit after 24 months of inactivity.
22. Is there any **unclaimed-property or escheat** exposure in India on forfeited
    balances?
23. Which standard applies to a private limited company at our stage — **AS or Ind AS**?
24. Free coins given away for signups and check-ins cost us a real payout when they are
    spent. How should they be treated — marketing expense, contra-revenue, or something
    else?

---

## 6 · Losses, reversals and value in kind

25. A user charges back a purchase **after** the coins have already been spent and the
    host has been paid. We bear the loss and never claw back from the host. Is that a
    deductible business loss?
26. We forfeit a banned user's coin balance. Is that revenue, or a write-back of a
    liability?
27. A host converts earned points **back into coins** to spend in the app. No cash
    leaves. We assume no TDS at that moment because the income arose when the points
    were credited. Is that right, and is the conversion itself a taxable supply to the
    host?
28. We plan to guarantee early hosts a minimum of roughly ₹15,000 a month while we seed
    the platform. Same TDS treatment as ordinary earnings, or different?

---

## 7 · Classification and structure

29. Given that hosts set their own hours, hold no exclusivity and are paid only on what
    they earn, can you confirm there is no **PF, ESI or gratuity** exposure? Would you
    rather labour counsel answered this?
30. Are there any **FEMA** considerations if a host, agency or sub-agent is not resident
    in India?
31. What books, registers and filings should we have in place **before** the first rupee
    of revenue, rather than discovering them at the first audit?
32. What is your fee structure, and what would you want from us monthly?
