# THE QUEUE — Game Design Document

**One-liner:** You are number 8,342,117 in line. The line is the game.
**Genre:** Satirical massively-shared idle / social experiment
**Platform:** iOS + Android simultaneously (one shared global state; web viewer for virality)
**Team:** 1–2 people · **Build:** ~3 weeks · **Business model:** Line-skips + cosmetics; this is the cheap, high-variance lottery ticket

---

## 1. Concept

Every player on Earth stands in one single, absurd, persistent queue. Nobody knows exactly what's at the front — the game only says **"You'll see."** Each month, whoever is #1 when the clock strikes finds out, receives a permanent trophy and title, and the line resets.

It is a satire of waiting, status, and microtransactions — and the satire *is* the monetization: you can pay to cut the line, but everyone you cut past gets notified, and you're permanently branded a **Line Cutter**. People will pay for the badge of shame. That's the joke, and the joke is the business model.

**Design philosophy:** r/place energy — one shared state, massive social proof, screenshot-native, deliberately shallow mechanics with deep social texture. Built in 3 weeks, killed or scaled by week 8.

## 2. Audience

Terminally online 16–35; meme-forward; the audience that made Wordle, r/place, and "A Dark Room" spread. Acquisition is 100% organic/viral by design — if this needs paid UA, it has already failed.

## 3. Core Loop

### Daily (60–90 seconds)
1. Open app → see your position, how many you passed overnight, who's directly ahead/behind you
2. **Check in** (one tap) → move up a base amount (passing everyone who didn't check in today — absence decay does the work)
3. Optional: one daily **Favor** — a 30-second minigame or absurd task ("hold the phone perfectly still for 20 seconds," "queue etiquette quiz") → bonus movement
4. Glance at your **Neighbors** (the 10 people around you): tiny proximity chat, emote at them. You'll leapfrog these same people for weeks — rivalries form on their own

### Passive
- Standing still is allowed; you drift backward slowly as active players pass you
- Push notification (max 1/day, off by default after first week): "You were passed by 12,041 people while you slept. Rude of them."

### Monthly climax
- Final 48 hours: check-in bonuses double, line skips get expensive (surge pricing as satire, clearly labeled as such), position ticker goes public on the web viewer
- #1 at reset gets: permanent **Front of the Line** trophy, custom title, their name engraved in the app's About screen forever, and the secret (see 4.3)

## 4. Systems Detail

### 4.1 Position math
- One global integer per player; check-in moves you past N inactive players (N scales with streak, capped)
- Skips move you past a fixed count, not a percentage — so whales at 10M-deep can't buy #1 outright; the final 100k positions can only be traversed by daily activity (protects the climax from pure pay-to-win, which would kill the joke and the press)

### 4.2 The Line Cutter economy
- **Cut the Line** IAP: +10k positions ($0.99), +100k ($4.99), +1M ($19.99, limited to 3/month/user)
- Everyone passed gets a feed entry: "M cut past you. Typical." Cutters wear a permanent 🔪 badge, cumulative ("Cut 2.3M people")
- **Hold My Spot** ($1.99/mo or watch-ad): freezes decay while you're inactive — the vacation-responder of queue games and the sneaky recurring revenue line
- Cosmetics: what you wear *in line* (avatars visible to your 10 neighbors and on shared screenshots): hats, signs ("HONK IF YOU'RE BORED"), pets, folding chairs. $0.99–4.99

### 4.3 What's at the front
- Month 1's winner discovers it and is sworn to a fun in-app "NDA" (they can leak it — that's free press either way)
- It should be genuinely funny and rotate monthly: a certificate, a picture of a door, the ability to choose next month's prize, one wish granted by the devs (within reason, publicly documented). The mystery is the content; never make it valuable enough to trigger sweepstakes law (below)

### 4.4 Legal guardrails (important)
- **No cash or cash-equivalent prizes, no entry fees for prize eligibility.** Paid skips must not be able to reach #1 (see 4.1) — this keeps it out of sweepstakes/gambling territory in most jurisdictions ("consideration + chance + prize" must never all three apply)
- Prizes are trophies/cosmetics/absurdities with no market value
- Have a games lawyer sanity-check the prize + skip design before launch (~$2–3k, non-negotiable)

## 5. Monetization

| Product | Price | Role |
|---|---|---|
| Line skips | $0.99–19.99 | Primary revenue; shame badge included free |
| Hold My Spot | $1.99/mo | Recurring floor |
| Cosmetics | $0.99–4.99 | Identity for neighbors + screenshots |
| Rewarded ads | — | Non-payers: +1 favor, hold-my-spot day |

**Revenue expectations, honestly:** this is a fad product. Model it as a spike: if it catches (say 5M downloads in a viral month), even 1.5% payer conversion at $6 ARPPU is ~$450k in the spike, plus a long tail. If it doesn't catch by week 8, it dies at a total cost of ~6 person-weeks. That asymmetry is the whole thesis.

## 6. Growth (the entire game is a growth mechanic)

1. **Position screenshots:** "#4,301 out of 6.2M" is inherently shareable; the app generates a beautiful ticket-stub card for every milestone
2. **Cut notifications** create outrage-engagement loops that players screenshot
3. **Web viewer** (no install): live global line ticker + the last 24h of drama; every share links here
4. **Neighbor rivalries:** leapfrogging the same stranger for three weeks is a story people tell
5. **Milestone events:** when the line hits 1M/5M/10M players, everyone present gets a commemorative cosmetic ("I was in line before it was long")
6. Launch beat: seed the mystery ("nobody knows what's at the front") to meme accounts; the speculation thread writes itself

## 7. Build Spec (3 weeks, 1–2 people)

- **Week 1:** global position service (a sorted set in Redis is genuinely almost the whole backend), check-in, decay, auth
- **Week 2:** app UI (position, neighbors, ticket-stub share cards), skips + IAP, favors (2 minigames)
- **Week 3:** web viewer, cut-notification feed, cosmetics (10 items), polish, legal review
- Infra note: one shared counter + neighbor windows shards trivially; cost stays low until millions of DAU, which is a good problem

## 8. Lifecycle Plan (decide in advance, avoid sunk-cost)

| Week | Gate | Action |
|---|---|---|
| 4 | <100k downloads, K-factor <0.5 | Kill. Write the postmortem thread (which itself markets your next game) |
| 4 | Viral (>500k, organic curve rising) | Add: squads-in-line, seasonal themes, more favors, second cosmetics drop |
| 12 | Retention floor found (>3% D30) | Live-ops mode: monthly prize rotation, 1 event/month, minimal staffing |
| — | Decline after peak | Sunset gracefully with a finale: the line reaches the front, everyone sees what's there. Legendary ending = reputation capital |

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| It's a fad | Priced in — 3-week build, pre-committed kill gates. The downside is a rounding error; the upside funds Face Down |
| Whales buy the climax | Skip caps + activity-only final stretch (4.1) |
| Sweepstakes/gambling law | No-value prizes, no pay-to-#1, lawyer review (4.4) |
| Dead-line cold start | Launch with bots? **No.** Instead: pre-registration IS standing in line ("the line forms before the app exists" — pre-reg position is your starting position). The waitlist for a game about waiting in line is self-marketing |
| Toxic neighbor chat | Emotes + preset phrases only, no free text. Solves moderation entirely |
| Clone apps within weeks | Certain, if it hits. Moat is the single shared line (network effect) and being the original; move fast on events |

## 10. KPIs

- K-factor (>0.5 or dead), daily check-in rate (>35% of installs), share-card generation rate, skip conversion (>1%), infra cost per DAU
- North star: **new players joining per day** — for a fad product, growth rate is the product

## 11. The case

The Queue is not the best game on the list — it's the best *bet structure*: near-zero cost, unbounded viral upside, pre-committed exit. Ship it first. Its realistic jackpot isn't its own revenue; it's a five-million-person audience and a proven studio name to launch Face Down into.
