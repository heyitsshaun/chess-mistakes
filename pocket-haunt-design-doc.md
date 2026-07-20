# POCKET HAUNT — Game Design Document

**One-liner:** A ghost that lives on your lockscreen and reacts to how you actually use your phone.
**Genre:** Widget pet / ambient life sim
**Platform:** iOS first (widget-native), Android fast-follow
**Team:** 2 people · **MVP:** ~10 weeks · **Business model:** Cosmetic IAP + subscription, light rewarded ads

---

## 1. Concept

A tiny ghost ("Haunt") inhabits your lockscreen and home-screen widgets. Unlike every widget pet before it, the Haunt reacts to your *real phone behavior*: it sleeps when you enable Do Not Disturb, eats when you charge, shivers when your battery is low, gets cozy at night, celebrates your alarms being dismissed on first ring, and sulks theatrically after long doomscroll sessions. It is a mirror of your phone life with a personality.

**Market proof:** Widgetable built a nine-figure-revenue category out of lockscreen pets and shared widgets. The category is validated; the differentiation here is **reactivity** (the pet responds to real behavior, not timers) and **haunting** (the social layer below).

**Why it retains structurally:** the pet is visible on every lockscreen glance — 80–150 times per day of ambient re-engagement with zero notifications sent.

## 2. Audience

- **Primary:** 13–24, iOS, Widgetable/Finch/Tamagotchi-nostalgia demographic, heavily female-skewing
- **Secondary:** Couples & best friends (the paired-widget use case that made Widgetable)
- Non-gamers welcome: there is no fail state, no skill, no session requirement

## 3. Core Loop

### Ambient loop (no action required)
1. Haunt reacts to phone state all day: charging = eating, DND = sleeping, low battery = shivering, late night = wrapped in a blanket judging you
2. Reactions generate **Ectoplasm** (soft currency) passively — richer reactions for healthier phone habits (first-alarm wakeups, DND streaks, charge-before-20% streaks)
3. Every lockscreen glance is a micro-session

### Active loop (2–3 min, 2–4×/day)
1. Open app → Haunt greets with a mood summary of your day ("you doomscrolled 47 minutes at 1am. we need to talk.")
2. Spend Ectoplasm: feed treats, decorate its room, buy furniture
3. Daily "Séance": a 30-second tap ritual that reveals a fortune/horoscope-style card (screenshot bait) and a daily gift

### Social loop — Haunting
1. Pair with a partner/best friend: your Haunt appears in *their* widget and vice versa (Widgetable's proven killer feature)
2. **The twist:** your Haunt reports on you. Partner's widget shows your Haunt's mood — sleeping means you're on DND, celebrating means you hit a habit streak. Ambient intimacy: "I can see you're finally asleep"
3. Send hauntings: 3/day free — your ghost briefly visits their lockscreen with a gift or a prank (fog, footprints, a floating cookie)

## 4. Systems Detail

### 4.1 Mood & bond
- Mood axis (gloomy ↔ radiant) driven by care actions + your phone-habit quality; purely cosmetic consequences (animations, room lighting) — **no punishment mechanics**, the pet never dies (Tamagotchi guilt sells short-term and churns long-term)
- Bond level (permanent, XP-based) unlocks new reactions, poses, and room slots — the collection spine

### 4.2 Evolution & collection
- Haunts grow through 5 life stages over ~6 weeks (paced to bridge the fad cliff)
- **Species determined by your actual habits** at evolution time: night owls hatch a Moth Wraith, early risers a Dawn Wisp, heavy texters a Chatter Poltergeist. Your pet is a personality test result → the single strongest screenshot/share hook in the design
- Second+ Haunt slots via IAP/sub; retired Haunts live in the "Attic" gallery (collection permanence)

### 4.3 Rooms
- Each Haunt has a room visible in the large widget and to paired friends; furniture is the infinite soft-currency sink with a real audience

### 4.4 Technical: iOS widget refresh budget
The known hard constraint. Mitigations: timeline-precomputed animations (schedule the day's mood arc in advance), push-triggered refreshes for partner events (APNs budget-friendly), exact-state sync on every app open, Live Activities for séance/charging moments. Widgetable proves this is workable; over-promise nothing in marketing about real-time.

## 5. Economy

| Currency | Earned | Spent |
|---|---|---|
| Ectoplasm (soft) | Ambient reactions, habit streaks, séance | Treats, furniture, prank hauntings |
| Candlelight (hard, IAP) | Purchase, rare milestones | Cosmetic eggs, room themes, extra Haunt slots, outfit shop |

- Cosmetic eggs are **choose-from-three**, not blind gacha (younger audience + platform risk; keeps ratings clean)
- Outfits/rooms have seasonal rotation (FOMO cadence without power creep)

## 6. Monetization

### Haunt+ subscription — $3.99/mo or $24.99/yr (priced under Widgetable's pet-bundle spend)
- 2nd Haunt slot, exclusive monthly outfit, unlimited hauntings, ad-free séance, partner-widget premium frames
- **Duo bundle $39.99/yr** — one purchase covers both paired users; the gift-a-sub flow is the top-converting surface (couples buy for each other; runs at Valentine's, anniversaries)

### IAP
- Candlelight packs $0.99–$19.99; outfits $1–3 equiv.; room themes $2–4; Haunt slots $4.99
- Evolution keepsakes: freeze a life-stage as a permanent widget skin ($2.99) — monetizes nostalgia for *their own pet*

### Rewarded ads (light, optional)
- 1–2 placements: double daily séance gift, +1 haunting. Never interstitial, never on the widget. ~10–15% of revenue, mostly from never-payers

### Revenue model (conservative)
| Metric | Year 1 target |
|---|---|
| Downloads | 2M (category demand is proven; ASO on "widget pet" is strong) |
| D30 | 10% |
| Payer conversion | 3.5% (cosmetic categories convert well with young/female skew) |
| Blended ARPDAU | $0.05–0.08 |
| **Year 1 revenue** | **~$2.5–4M**, with clear scaling path — this is a live-ops cosmetics business |

## 7. Growth

1. **Pair mechanic = built-in invites** (the Widgetable playbook: "download this so my ghost can live on your phone" is an irresistible ask between teens/couples)
2. **Evolution-as-personality-test** screenshots ("I got Moth Wraith because I never sleep")
3. TikTok-native content: the pet reacting to relatable phone behavior is an endless meme format; seed 20 creators at launch
4. Seasonal skins around Halloween (obviously our Christmas), Valentine's (duo bundle), back-to-school

## 8. MVP Spec (10 weeks, 2 people)

**In:** 1 species line (5 stages), 8 reactions (charge, DND, low battery, night, morning alarm, doomscroll-length, weather, weekend), lockscreen + home widgets, pairing + partner widget, 3 hauntings/day, room with 20 furniture items, séance, sub + Candlelight + 10 outfits
**Out (v1.1+):** habit-based species branching, Live Activities, Android, duo bundle, Attic, rewarded ads
**Soft-launch gates:** D1 >45%, D7 >20%, pair rate >25% of D7 users, payer conversion >2%

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Widgetable ships the same reactivity | Speed + tone (they're utility-cute; we're personality-first). Reactivity depth is a moving target they'd chase, not set |
| iOS widget refresh limits break the illusion | Timeline precompute + honest marketing ("checks in on you all day," not "real-time") |
| Privacy optics (reading phone state) | All on-device signals (battery, DND, screen time API with permission); publish a plain-language privacy page; nothing leaves the device but mood states |
| Young audience + spending | Choose-from-three eggs (no blind gacha), parental spend caps honored, COPPA-clean design |
| Fad cliff at week 3 | Evolution arc lands week 4–6, bond permanence, seasonal live-ops calendar from day one |
| Category saturation | Compete on the only axis incumbents ignore: the pet *knows you*. That's the moat and the marketing in one sentence |

## 10. KPIs

- North star: **paired-user share of WAU** (paired users retain and pay at multiples of solo users)
- D1/D7/D30: 45/20/10 · Payer conversion 3.5% · Widget-install rate >70% of D1 users
- Séance completion >50% DAU (the daily habit anchor)

## 11. The case

This is the lowest-risk doc of the three: the category is proven at nine-figure scale, the build is small, and the differentiation (a pet that reacts to real phone behavior, and reports your day to the person who loves you) is a one-sentence pitch that sells itself between friends. It won't headline the App Store the way Face Down can — but it has the highest floor, and cosmetics live-ops compounds.
