# DUPE RADAR — Product Design Document

**One-liner:** See the cheaper twin of anything you're about to buy.
**Category:** Browser extension + mobile app (share-sheet) + creator web tools
**Team:** 2–3 people · **MVP:** ~10 weeks · **Business model:** Affiliate revenue + Pro subscription

---

## 1. Concept

You're on a product page. Dupe Radar's badge lights up: **"3 dupes found — best: $14 vs $52."** Click it and see same-factory equivalents, generic twins, and near-identical alternatives — each with price history, a **fake-discount detector** ("this 'was $99' price existed for 4 days in March"), and a review-authenticity grade.

**Why now:** "dupe" is a cultural movement, not a feature — billions of TikTok views, an entire creator economy, and a generation that treats finding the $12 version of the $68 thing as a sport. Honey proved the checkout-extension affiliate model to the tune of a $4B acquisition — but Honey saved people 5% with coupons. Dupes save 60–80%. The value per activation is an order of magnitude bigger, and so is the shareability.

**Positioning:** Honey found you a coupon. Dupe Radar finds you a better decision.

## 2. Audience

- **Primary:** 18–34 women, beauty/skincare/home/fashion buyers, TikTok-native, already searching "X dupe" manually
- **Secondary:** general deal-seekers (the camelcamelcamel/Keepa crowd) via price-history + fake-discount features
- **Creators:** dupe-content creators who need link tooling (they're the growth engine, see §7)

## 3. Product Surface

### 3.1 Extension (core)
- Badge on any product page across major retailers (Amazon, Sephora, Ulta, Target, Walmart, Zara, West Elm, etc.)
- Panel: dupes ranked by **match confidence × savings**, each with side-by-side spec/ingredient comparison, community verdict ("2,341 people confirmed this dupe"), price history sparkline
- **Fake-discount detector** on the *original* product: real price history vs. claimed discount — works even when no dupe exists, so the extension is useful on every page (daily-utility retention, not occasional)

### 3.2 Mobile app
- Share-sheet: share any product link or **photo** (camera → visual match) → dupes. In-store scanning is the killer demo
- Watchlist: price alerts on both originals and dupes

### 3.3 Creator tools (web)
- "Dupe pages": creators publish comparison pages with their affiliate share baked in — every creator becomes a distribution node

## 4. The Dupe Graph (the moat)

Three matching layers, each validating the next:

1. **Harvested claims:** NLP over public dupe mentions (TikTok captions, Reddit r/MakeupAddiction etc., YouTube transcripts) → candidate edges with source counts
2. **Similarity engine:** embedding match on product images, ingredient lists (beauty), materials/dimensions (home), specs (electronics) → confidence score
3. **Community confirmation:** one-tap "I bought both — real dupe / not a dupe" from users; confirmations weight rankings

The graph compounds: every user interaction improves match quality, and the confirmed-dupe dataset itself becomes licensable. Cold-start is *harvest-first* — launch with ~50k high-confidence edges in beauty + home before anyone installs it.

## 5. Revenue

### Affiliate (primary)
- Dupe sellers (Amazon associates, drugstore brands, marketplaces) pay 3–12% commissions; beauty/home skew high
- Key economics: we redirect *intent that already exists* toward purchases with higher commission rates (generic/marketplace goods out-commission prestige brands)
- Average captured basket $25, blended 6% commission = ~$1.50/conversion. Extension users converting 1.5×/month → **~$25–30/active user/year**

### Pro subscription — $29.99/yr
- Unlimited price-history alerts, in-store visual scan, early access to new verticals, no "supported by affiliate links" footer
- Target 3% of MAU

### Later: data licensing
- The confirmed-dupe graph + real price-history corpus is valuable to brands (who dupes me?), retailers, and market researchers

### Model (conservative)
| Metric | Year 1 target |
|---|---|
| Installs | 800k (creator-led; comps: dupe hashtag demand) |
| MAU | 350k |
| Affiliate revenue | ~$3–4M |
| Pro subs | ~10k → $300k |
| **Year 1 revenue** | **~$3.5–4.5M** |

## 6. Ethics & the Honey lesson (critical)

Honey was sued and publicly torched for silently hijacking creators' affiliate attribution. Our rules, stated publicly:

1. **Never touch attribution we didn't earn.** Only attach affiliate tags when the user clicks through *our* dupe panel
2. **Disclose everywhere:** "We earn when you buy through dupe links" in-panel, permanently
3. **Creators get a cut** of conversions from their dupe pages — creators are partners, not victims. This turns the community that destroyed Honey's reputation into our sales force

## 7. Growth

1. **Creator flywheel:** 100 seeded dupe creators get custom pages + rev share. Their content already screams "link in bio" — we *are* the link in bio
2. **Screenshot economy:** the panel generates a shareable "receipt" card — original vs. dupe, savings amount, match confidence. "$54 saved" cards are TikTok-native content
3. **SEO layer:** every confirmed dupe edge auto-generates an indexable comparison page ("CeraVe vs. [prestige cream]") — the query volume for "X dupe" is enormous and underserved by structured content
4. **Fake-discount virality:** Black Friday is our Super Bowl — "we checked 100k 'deals'; 61% were fake" is a guaranteed annual press cycle
5. **In-store scan demos:** filming the camera finding a $9 twin of a $70 item is inherently viral

## 8. MVP Spec (10 weeks, 2–3 people)

**In:** Chrome extension, 2 verticals (beauty, home), 50k harvested dupe edges, price history + fake-discount detector for top 5 retailers, affiliate integration (Amazon + 2 networks), share cards, basic community confirm
**Out (v1.1+):** mobile app + visual scan, creator pages, Pro sub, Safari/Firefox, more verticals
**Gates at week 16:** weekly active rate >30% of installs, panel-open rate >20% of product pages with matches, affiliate conversion >1%/MAU/month, match-quality thumbs-up >80%

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Retailers block scraping/extension | Render from user's own page context (extension reads DOM client-side); price history via distributed collection; standard cat-and-mouse, priced in |
| Affiliate network dependency (Amazon can cut rates/kick you) | Multi-network from day one; direct brand deals with dupe-side brands (they *want* this traffic) |
| Match quality embarrassments (bad dupe goes viral) | Confidence thresholds, "community-confirmed" tier shown by default, fast kill-switch per edge |
| Brand legal pressure (trademark/disparagement) | Factual comparison is protected; never claim "identical," show data; counsel review of claim language |
| Honey-style reputation attack | §6 rules from day one, publicly; creators paid, attribution untouched |
| Chrome Manifest/platform risk | Mobile app + web pages diversify distribution beyond the extension |

## 10. KPIs

- North star: **confirmed-dupe conversions/week** (aligns users, creators, and revenue)
- Panel open rate, dupe CTR >25%, affiliate conv >1%/MAU/mo, edge confirmation rate, creator-page share of installs >30%

## 11. The case

This is the strongest pure business on the list: proven model (Honey), 10× the per-use value (60–80% savings vs. 5% coupons), a pre-existing culture doing our marketing for free, a compounding data moat, and a built-in creator sales force that the incumbent alienated. The fake-discount detector makes it useful on *every* product page, solving the extension-retention problem that kills most shopping helpers.
