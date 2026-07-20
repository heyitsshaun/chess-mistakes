# OWED — Product Design Document

**One-liner:** The autopilot that collects money you're owed and didn't know about.
**Category:** Consumer fintech-adjacent web/mobile app
**Team:** 3 people · **MVP:** ~14 weeks · **Business model:** Success fee (15% of recovered money). No recovery, no charge — ever.

---

## 1. Concept

Connect your email once. Owed continuously finds and files everything you're entitled to:

1. **Class-action settlements** — the anchor stream. Billions go unclaimed yearly because claims take 15 minutes of form-filling; the average consumer qualifies for several per year at $10–150 each. Owed matches your purchase history (from email receipts) against open settlements and files with your authorization
2. **Late-delivery & guarantee credits** — shipping promises broken, delivery guarantees unhonored
3. **Price-adjustment refunds** — retailers with adjustment policies when prices drop post-purchase
4. **Airline compensation** — delayed/canceled flights (US DOT refund rules, EU261 where applicable)
5. **Unclaimed property** — automated search of all 50 states' databases (people move; money doesn't follow)
6. **Zombie subscriptions & double charges** — flagged from receipts (v2)

**The pitch that sells itself:** a push notification that says "**You just got $43.** (Class action: [brand] settlement. You bought it in 2024. We filed. It's in your account.)" That notification is the product, the retention, and the marketing.

**Alignment:** success-fee-only means every incentive points the same way. The company only eats when users get paid.

## 2. Audience

Everyone with an email address and purchase history — but launch wedge: online-shopping-heavy US consumers 25–45 (deepest receipt trails, most settlement eligibility). No financial sophistication required; the entire UX is "connect email → watch money arrive."

## 3. Product Flow

### Onboarding (3 minutes)
1. Connect email (read-only, receipts-scoped where supported) → instant scan → **"We found $127 you can claim right now"** (the aha moment must land in onboarding, before any commitment)
2. One-time identity + e-signature authorization (required for filing on user's behalf)
3. Payout method (Stripe/ACH)

### Ongoing (zero effort — this is the point)
- Continuous matching: new settlements, new receipts, flight disruptions
- Each find: notification → one-tap approve (or auto-approve under $50, user setting) → Owed files → money lands → 15% deducted transparently
- Monthly statement: "Lifetime recovered: $312. Our cut: $47."

### The ledger (retention surface)
- A running list of claims in flight with status ("filed — payouts expected Q3") — checking it has lottery-ticket dopamine, and pending claims give users a reason never to churn

## 4. Systems Detail

### 4.1 Settlement engine (the moat)
- Structured database of open class actions: eligibility rules, proof requirements, deadlines, payout estimates — built by parsing settlement administrators' sites + legal filings, maintained by a paralegal-grade ops pipeline (LLM-assisted extraction, human-verified)
- Matching: receipt corpus × eligibility rules → claim candidates ranked by expected value × confidence
- Filing: direct integration where administrators allow; assisted-form automation elsewhere; always under user's e-signed authorization

### 4.2 Email intelligence
- Receipt/itinerary parsing (same category as Paribus/TripIt — well-trodden)
- **Privacy is existential:** receipts-only scoping, no ad targeting, no data resale, delete-everything button, SOC 2 from early. Note: Gmail restricted-scope API requires a third-party security audit (budget ~$15–75k and weeks of lead time — plan this before launch, not after)

### 4.3 Payout & trust
- Recovered funds go *directly to user* wherever possible (checks/deposits from administrators); Owed invoices its 15% after — this ordering maximizes trust and minimizes money-transmitter licensing exposure. Where funds must route through us, use a licensed payments partner (Stripe Treasury or similar)

## 5. Revenue

- **15% success fee** on recovered money (AirHelp charges 35%; being visibly cheaper than the category is part of the pitch)
- Estimated recoverable per active user per year: $60–150 (settlements $40–90, delivery/price credits $10–30, flights sporadic but large, unclaimed property one-time spikes often $100+)
- → **$9–22 revenue per active user/year**, at near-zero marginal cost once pipelines exist

| Metric | Year 1 target |
|---|---|
| Signups | 600k (viral payout screenshots + press) |
| Activated (email connected) | 350k |
| Avg recovered/activated user | $70 |
| **Gross recovered** | ~$24M |
| **Year 1 revenue (15%)** | **~$3.5M** |

Unclaimed property alone is a famous one-time acquisition hook: "check if your state owes you money" quizzes reliably go viral.

## 6. Legal & Compliance (respect it or die)

| Issue | Position |
|---|---|
| Filing claims for others | Permitted with user authorization (claims-assistance, not legal advice); e-sign per claim category; counsel-reviewed ToS. This is form-filing, not practicing law — keep it that way (no advice, no disputes) |
| Unauthorized practice of law | Never advise on legal rights; present facts + file forms only |
| Money transmission | Route payouts direct-to-user; partner-bank rails if we ever hold funds |
| Fraudulent claims exposure | File only with documentary evidence (the receipt IS the proof); this is also why email-connection matters — we're *more* accurate than self-serve claimants |
| Settlement administrators pushing back | We increase legitimate claim rates with better documentation; build admin relationships, not adversarial scraping |
| State unclaimed-property finder laws | Several states regulate paid "finders" (fee caps, registration). Geo-gate this stream by state; free tier where fees are restricted |

Budget real legal counsel from month one (~$30k year one). It's the cost of the moat: this compliance burden is exactly why competitors stay away.

## 7. Growth

1. **The payout screenshot:** "I connected my email and got $43 for nothing" — every payout generates a share card. This category markets itself (Paribus grew to millions of users on this loop before its Capital One acquisition)
2. **Unclaimed-property checker** as free viral top-of-funnel (no signup to search, signup to claim)
3. **Press:** "app finds Americans the $X billion in unclaimed settlements" is an evergreen story every consumer-money journalist wants
4. **Referrals with teeth:** referrer gets fee-free recovery on their next claim
5. SEO: every open settlement gets an explainer page ("Are you eligible for the [X] settlement?") — high-intent search traffic that converts

## 8. MVP Spec (14 weeks, 3 people)

**In:** email connect + receipt parsing (Gmail first), settlement database (top 40 open settlements), matching + e-sign + assisted filing, unclaimed-property search (10 largest states), payout tracking ledger, share cards
**Out (v1.1+):** airline compensation, price adjustment, auto-approve, Outlook/Yahoo, subscription-audit stream
**Gates:** activation (email connect) >50% of signups, ≥1 claim found for >60% of activated users, filed-claim payout rate >40%, CAC ≈ $0 (organic) holding

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Gmail API audit cost/delay | Start audit process pre-launch; Outlook + forward-your-receipts fallback |
| Retailer/airline countermeasures (killed Paribus' price stream) | Diversified streams — settlements + unclaimed property don't depend on any retailer's goodwill |
| Trust barrier ("read my email?!") | Receipts-only scope, radical transparency page, SOC 2, delete-all button, and the strongest argument: visible money in your account |
| Long settlement payout lags (6–18 mo) | UX sets expectations; fast streams (delivery credits, unclaimed property) deliver early wins while settlements cook |
| Fee compression / competitors | 15% + best settlement database + trust brand; the ops pipeline is the moat |
| Regulatory drift | Counsel on retainer; geo-gating machinery built early |

## 10. KPIs

- North star: **dollars recovered per activated user per year**
- Activation >50%, claims-per-user, payout conversion, time-to-first-dollar (<30 days target), share-card rate per payout, fee revenue per user

## 11. The case

"Found money" is the single most persuasive pitch in consumer software — it requires no behavior change, no habit, no taste. The success-fee model makes trust rational, the payout screenshot makes growth free, and the unglamorous compliance + ops pipeline is a real moat precisely because it's unglamorous. Slowest build of the three, biggest brand at the end: everyone is owed something.
