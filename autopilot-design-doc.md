# AUTOPILOT — Product Design Document

**One-liner:** Every deadline adulthood throws at you — tracked, prepared, and half-done before you open the app.
**Category:** Mobile-first app + email intelligence; "life admin OS"
**Team:** 3 people · **MVP:** ~12 weeks · **Business model:** Pro subscription + switching/renewal lead-gen (the real engine)

---

## 1. Concept

Adult life is ~40 recurring deadlines nobody manages: passport, driver's license, car registration, inspection, insurance renewals (auto/home/renters/life), lease end, benefits enrollment, tax dates, prescription renewals, professional certifications, domain names, HVAC filters, vehicle recalls. Missing them costs real money (lapsed insurance, expired registration tickets, expedited passport fees) and renewing them *without shopping* costs even more (auto-renewed insurance premiums drift up 10–20%/yr on inertia).

Autopilot builds your **Deadline Map** in one 10-minute onboarding, then does the part everyone hates: it doesn't just remind you — it **prepares the action**. When your registration is due, the form is prefilled and the DMV link is right there. When your auto insurance renews, Autopilot has *already pulled comparison quotes* — and that moment is worth $40–80 per user to insurance marketplaces, which is the business model hiding inside the utility.

**Positioning:** Rocket Money manages your subscriptions. Autopilot manages your obligations.

## 2. Audience

- **Primary:** 25–40, recently promoted into adulthood: new lease, new car, new baby, new house. Life events create deadline clusters *and* switching moments (insurance!) simultaneously
- **Secondary:** the sandwich generation managing parents' + kids' documents (family plan)
- Willingness to pay comes from anxiety relief — this sells like insurance, not like entertainment

## 3. Product Flow

### Onboarding (the magic 10 minutes)
1. Scan wallet: driver's license, insurance cards, registration (OCR → expiry dates captured)
2. Connect email (optional but pushed): finds policies, leases, subscriptions, domains, past renewals automatically
3. 12-question sweep ("Own a car? Rent? Passport? Professional license?")
4. Output: your **Deadline Map** — a single timeline of everything, color-coded by cost-of-missing. Seeing your whole adult life on one screen is the screenshot moment

### Ongoing
- **Smart escalation:** 90/30/7-day nudges, calibrated to processing time (passports nag at 9 months for the procrastination-adjusted deadline)
- **Prepared actions:** each deadline card carries the checklist, the prefilled form or deep-link, required documents (pulled from the vault), fees, and expected processing time
- **Shoppable renewals:** 45 days before any insurance renewal: "Your premium is $1,340. We found $1,050 for the same coverage. Want quotes?" → marketplace handoff = revenue event
- **Document vault:** encrypted storage of the documents deadlines need (passport photos, VIN, policy PDFs) — utility + lock-in

### Household
- Family plan: shared map for partners, kids' passports/physicals/school forms, aging parents' renewals. Households retain far better than individuals and double the deadline surface

## 4. Systems Detail

### 4.1 Deadline knowledge base (the moat)
- Per-jurisdiction rules: renewal cadences, grace periods, fees, processing times, required documents, links — for 50 states + federal (passport, Global Entry, TSA Pre) + common professional licenses
- Maintained via LLM-assisted monitoring of official sources + user-report corrections. Boring to build, painful to replicate — same moat species as Owed's settlement database

### 4.2 Email intelligence
- Policy/lease/renewal detection from inbox (receipts-scope; same privacy posture as any serious fintech: no resale, delete-all, SOC 2 path)

### 4.3 Lead-gen plumbing
- Insurance: integrate marketplace APIs (auto/home/renters) — payouts per qualified quote-start, larger on bind
- Later: mortgage refi triggers, energy switching (deregulated states), credit-card annual-fee reviews
- **Trust rule:** recommendations ranked by user savings, never by payout; disclose compensation plainly. The utility earns the right to the marketplace, and dies if users smell steering

## 5. Revenue

### Lead-gen (primary)
- Auto insurance alone: if 40% of users hold a policy and 25% of those accept a quote flow yearly at $45 avg payout → **~$4.50/user/yr**, before home/renters/refi/energy
- Renewal moments recur annually forever — this is lead-gen with *structural* timing advantage (we know the renewal date; nobody else does)

### Pro subscription — $49.99/yr (family $79.99)
- Unlimited items + vault, household sharing, concierge prep (we fill the form, you sign), priority processing alerts
- Free tier: 5 tracked deadlines, basic reminders — enough to hook, not enough for a household

| Metric | Year 1 target |
|---|---|
| Downloads | 500k (life-event SEO + press + App Store utility placement) |
| Activated (map built) | 250k |
| Lead-gen revenue | ~$1.1M |
| Pro conversion 4% | ~$500k |
| **Year 1 revenue** | **~$1.6M**, scaling steeply in year 2 as renewal cycles compound (every user's insurance renews *every* year) |

Year-2 upside: B2B — employers buy family plans as a benefit (HR loves "fewer distracted employees"); insurance agencies license renewal-timing intelligence.

## 6. Growth

1. **Life-event SEO:** "passport renewal how long 2026," "car registration [state] fee" — enormous, evergreen, high-intent query volume; every KB entry becomes a public explainer page with the app as the tool
2. **The Deadline Map screenshot:** seeing your whole adult life on one screen is inherently shareable ("I had 23 deadlines I didn't know about")
3. **Household invites:** the family plan requires the partner — a natural, non-spammy invite
4. **New-mover/new-parent channels:** partnerships with moving companies, hospitals' new-parent packets, university career centers (first-apartment kits)
5. **Annual January press beat:** "the 12 deadlines Americans miss most" — resolution-season catnip
6. **App Store:** utilities with clean privacy stories get featured; "digital life admin" is an editorial narrative waiting for a poster child

## 7. MVP Spec (12 weeks, 3 people)

**In:** wallet-scan OCR + manual add, deadline KB for top 10 states + federal documents, Deadline Map UI, smart reminders, prepared-action cards for 15 highest-value deadline types, auto-insurance quote integration (1 marketplace), doc vault (basic), Pro sub
**Out (v1.1+):** email intelligence, family plan, concierge, all-state coverage, home/renters/refi lead-gen, Android-first? (no — iOS first, buyer demographics)
**Gates:** onboarding completion >55%, ≥8 deadlines mapped per activated user, 90-day retention >25% (deadline apps get natural re-engagement), quote-flow acceptance >15% of eligible renewals

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| "It's just a calendar" perception | The prepared action IS the product — never ship a reminder without the form/link/checklist attached. Calendars tell you; Autopilot half-does it |
| KB accuracy (wrong fee/date = broken trust) | Official-source citations on every card, user-report flow, jurisdiction-by-jurisdiction rollout rather than thin national coverage |
| Lead-gen conflicts with trust | Ranking by user savings, plain disclosure, no dark-pattern urgency. Long-game: trust compounds into higher accept rates |
| Insurance licensing creep | Stay marketplace-referral side of the line (no advice, no binding); licensed-partner route if we ever go deeper |
| Low-frequency engagement | Correct — and fine. This is an appointment product; notifications are *welcome* because each one carries money/consequence. Optimize for annual LTV, not DAU |
| Sherlocking (Apple Wallet, Google) | Platforms do storage, not jurisdictional knowledge + prepared actions + switching economics. The KB + marketplace layer is the defensible part |

## 9. KPIs

- North star: **deadlines successfully completed through the app** (proxy for trust → renewals → lead-gen LTV)
- Onboarding completion, deadlines per user, notification→action rate, quote acceptance rate, Pro conversion, 12-month retention (>35% target — the product's value recurs annually by nature)

## 10. The case

Autopilot is the slow, compounding one: modest year-1 revenue but the best LTV curve of the three, because its core events — renewals — recur every year forever, and it knows their dates before anyone else in the market does. That timing knowledge turns a humble utility into a lead-gen machine with a moral high ground: the app makes money by saving users money at exactly the moment they'd otherwise overpay on autopilot. Pun intended, and load-bearing.
