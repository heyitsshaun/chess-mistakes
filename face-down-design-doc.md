# FACE DOWN — Game Design Document

**One-liner:** The game you win by putting your phone down.
**Genre:** Multiplayer idle battler / digital-wellbeing hybrid
**Platform:** iOS first (widget ecosystem), Android fast-follow
**Team:** 2–3 people · **MVP:** ~12 weeks · **Business model:** Subscription + IAP, deliberately ad-free

---

## 1. Concept

A creature-garden battler where *not using your phone* is the gameplay. Phone face-down and locked: your creatures gather resources, your walls charge, your streak grows. Phone in use: your defenses are literally down — rivals can raid you.

**The novel core mechanic:** being on your phone lowers your defenses *diegetically*. The counterplay to being attacked is to lock your phone. The game's incentives and the player's real-life interests point in exactly the same direction — which makes it retention-positive, press-friendly, and guilt-free to pay for.

**Positioning:** Forest is a timer with a tree skin. Opal is a blocker with a paywall. Face Down is the first actual *multiplayer game* competing for the self-improvement dollar.

## 2. Audience

- **Primary:** Students 16–26 (exam culture, screen-time guilt, squad-native)
- **Secondary:** Professionals 25–40 (deep-work culture, Duolingo-streak psychographic)
- **Tertiary/buyer:** Parents purchasing subscriptions for teens
- Explicitly a **non-gamer TAM**: anyone with a phone and guilt about it.

## 3. Core Loop

### Passive loop (the real game)
1. Player locks phone / places face-down → **Focus Session** begins (accelerometer + screen-state detection; server heartbeat like Forest — solved problem)
2. Creatures gather **Dew** (soft currency) per focus-minute; walls charge toward full shield
3. Lockscreen widget shows garden state live — the player "plays" every time they glance at their phone without unlocking it
4. Unlock phone → 5-minute grace shield → then **raidable**

### Active loop (60–120 second check-ins, 3–5×/day)
1. Spend Dew: feed/evolve creatures, decorate garden, build defenses
2. Raid tab shows friends who are on their phones *right now* ("3 squadmates are scrolling — raid now")
3. Queue raids, collect loot, repair from raids received
4. Check squad league standing

### Social loop (weekly)
- **Squads of 5–20** (study group, office, family) compete in weekly leagues on combined focus-hours + raid performance
- Squad chest requires everyone contributing → Duolingo-style social obligation

## 4. Systems Detail

### 4.1 Focus & growth
- Dew earn rate: 1/min base, ×1.5 during player-scheduled "Deep Hours," ×2 during squad events
- Diminishing returns after 4h/day (prevents overnight-idle exploitation; sleep tracked separately as a cozy "moonlight" bonus capped at 8h)
- Creatures have growth stages gated by *consecutive* focus (e.g., "evolve after a 45-min unbroken session") — teaches real focus habits

### 4.2 Raids (async, capped, soft)
- Raiding costs Energy (3/day free); target selection prioritizes squadmates and rivals near your league rank
- Raid = 30-sec auto-battle: your creatures vs. their (weakened-while-scrolling) defenses
- **Loss caps: max 5% of victim's unbanked Dew, cosmetics never lootable.** Raids sting enough to motivate, never enough to rage-quit
- Getting raided sends: "Kira is raiding your grove — put me down to fight back." Locking your phone within 60s deploys full defense
- Revenge raids are free → grudge loop

### 4.3 Streaks
- Daily streak = ≥30 focus minutes. Rest days: 1 earned per 7-day streak, bankable to 3 (ethical moat: we sell repair, but we also give rest)
- Streak milestones unlock creature species (identity, not power)

### 4.4 Seasons & leagues
- 6-week seasons: cosmetic track (free + premium), themed biome, league resets
- Leagues: Bronze→Mythic, promotion by focus-hours + raid rating. Rank decay only from *phone overuse*, never absence — you can't lose rank by living your life

## 5. Economy

| Currency | Earned | Spent | Notes |
|---|---|---|---|
| Dew (soft) | Focus minutes, raids, quests | Creature growth, decor, walls | Raidable when unbanked |
| Amber (hard) | IAP, rare milestones | Shields, streak repair, gacha-free cosmetic shop, season pass | No loot boxes — direct purchase only |
| Energy | 3/day, +2 sub | Raids | Caps whale harassment |

**Sinks vs. sources:** decor is the infinite Dew sink (visible to raiders and squadmates, so it has an audience). Walls decay slowly, creating steady maintenance demand. No power sold, ever — power comes only from focus. **You literally cannot pay to win; you can only pay to protect, decorate, and repair.** This is both the ethical stance and the App Store review insurance.

## 6. Monetization

**No ads.** "We don't want your screen time" is the brand, the press hook, and the subscription pitch.

### Focus+ subscription — $5.99/mo or $39.99/yr (anchor to Opal at ~$99/yr)
- Advanced focus stats & weekly reports (the self-improvement justification)
- +2 raid energy, exclusive biomes, 1 free streak repair/month, squad size 20
- Family plan $59.99/yr (parent buys for teens = 3 subs in one decision)

### IAP (Amber packs $1.99–$49.99)
- **Streak repair** ($1.99 equiv.) — the elite converter; loss aversion at its purest
- **Raid shields** (8h/24h/weekend) — bought in bursts around exams/vacations
- **Cosmetics** — creature skins, garden themes, wall styles; audience = raiders + squad + your own lockscreen
- **Season pass** ($9.99) — premium cosmetic track

### Revenue model (conservative)
| Metric | Year 1 target |
|---|---|
| Downloads | 1.5M (featuring + press + squad K-factor) |
| D30 retention | 12% (structural: the phone is the controller) |
| Sub conversion of MAU | 2.5% → ~75k subs |
| Sub ARR | ~$2.6M (blended $35/sub/yr) |
| IAP ARPDAU (non-sub) | $0.03–0.05 → ~$1M |
| **Year 1 revenue** | **~$3.5M** on a 3-person team |

Upside case (one viral cycle or Apple feature): 3–5× these numbers. B2B (school/company focus challenges, $3/seat/yr) is the year-2 second act.

## 7. Growth

1. **Built-in K-factor:** squads require inviting classmates/coworkers; raids need friends. Solo play works but squad play is obviously better
2. **Screenshot economy:** streak cards, season recaps, "raided while scrolling" receipts, league promotions — all one-tap shareable
3. **Press/featuring:** digital-wellbeing is App Store editorial catnip and a journalist-friendly story ("the game that fights your phone for you")
4. **Seasonal beats:** "Finals Week World Cup" (universities compete), "January Detox League" (New Year resolution surge = our Christmas)
5. **Zero brand-safety risk** → creator sponsorships in studytube/productivity niches are cheap and native

## 8. MVP Spec (12 weeks, 2 engineers + 1 designer/artist)

**In:** focus detection + Dew, 1 creature line (3 evolutions), lockscreen widget, streaks + repair IAP, squads of 5, async raids with shields, 5 cosmetics, Focus+ sub, basic stats
**Out (v1.1+):** leagues, seasons/pass, biomes, family plan, Android, B2B
**Kill/scale gates at week 16 soft launch (PH/NZ):** D1 >40%, D7 >18%, sub conversion >1.5%, K-factor >0.3. Two of four → iterate; zero → kill.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Cheating (second device) | Soft PvP + capped losses; cheaters only cheat their own stats. No leaderboard-critical stakes on raw hours |
| Streak anxiety / dark-pattern optics | Rest days, generous repair, absence never punished — being the ethical one IS the moat |
| iOS background detection limits | Screen-state + motion + server heartbeats (Forest-proven); degrade gracefully to honor-mode timer |
| Forest/Opal similarity claims | Different mechanic (multiplayer raids), different fiction (creatures), different model (game, not tool) |
| Widget refresh budget (iOS) | Timeline-based widget updates precomputed at session start; exact-state on unlock |
| Fad decay | Seasons + leagues + sub give an evergreen spine; wellbeing need is permanent, not trendy |
| Raids feel mean | Loss caps, revenge-free mechanic, squad-first targeting, opt-out "Zen mode" (grow-only, still sub-eligible) |

## 10. KPIs

- North star: **weekly focus-hours per user** (aligns product, revenue, and user benefit)
- D1/D7/D30: 45/20/12 targets
- Sub conversion 2.5%+, sub churn <5%/mo, streak-repair attach >8% of streak-breaks
- K-factor >0.4 via squad invites

## 11. Why this wins (the case, restated)

Every other concept optimizes retention *against* the user's interests and pays for it in churn, guilt, and platform risk. Face Down is the only design where retention, monetization, distribution, and public goodwill all point the same direction. Its DAU is structural (the phone is the controller), its TAM is everyone with screen-time guilt, its dollars come from the self-improvement budget (higher willingness to pay, zero purchase regret), and its story writes its own press. It is also, unglamorously, one of the cheapest concepts on the list to actually build.
