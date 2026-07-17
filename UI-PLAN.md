# UI overhaul plan — "Midnight club" + "Blush studio"

Two themes, one design. **Midnight club** (dark): deep, slick, inviting — warm grade
colors, a friendly periwinkle accent, soft glows, playful micro-motion. Late-night
chess lounge, not server room. **Blush studio** (light): soft ivory and beige with
dusty rose and gentle supporting colors — warm and calm, girl-friendly without being
girly. Same layout, same components, same motion; only the tokens change.

Theme mechanics: see §1b "Theme system" — a registry of built-in and user-defined
themes applied as CSS variables, with separate light/dark assignments and a
system-preference mode (on by default).

The UI layer is the only thing that changes. `core.js` (the CMT API), the data model,
and the test suite are untouched — `npm test` green means the overhaul broke nothing.

---

## 1. Design tokens

Replace the current palette in `styles.css` wholesale:

```
Backgrounds       --bg: #0e1116          page (near-black, blue-warm, never pure black)
                  --surface-1: #151a21   panels
                  --surface-2: #1c232d   cards, inputs
                  --surface-3: #232c38   hover/raised
Text              --text: #e8edf4        primary
                  --muted: #8d99ab      secondary
                  --faint: #5c6675      hints, coords
Accent            --accent: #7aa2f7      actions, links, book, best-move arrow
                  --accent-soft: #7aa2f733  glows/tints (use sparingly)
Grades (lively)   --best: #34d399  --excellent: #6ee7b7  --good: #a3d977
                  --inacc: #fbbf24  --mistake: #fb923c  --blunder: #f87171
Board             --sq-light: #aeb9c8  --sq-dark: #5c6e85
                  --sq-sel: #f6d76b    --sq-hint: rgba(0,0,0,.28)
Semantic          --danger: #f87171  --success: #34d399
Radius            --r-sm: 8px  --r-md: 12px  --r-lg: 16px (cards & board)
Shadow            0 8px 24px rgba(0,0,0,.35) on raised layers only (detail sheet, menus)
Type              Inter (Google Fonts) with system-ui fallback; tabular-nums for stats
                  Display 20/600 · Section 15/600 · Body 14/450 · Caption 12/500
Motion            120ms ease-out (hover) · 220ms cubic-bezier(.2,.9,.3,1.2) (selection pop)
                  Respect prefers-reduced-motion: reduce → no transforms, opacity only
```

Rules that keep it "lively but tasteful": one accent color for interaction; grade
colors are the only rainbow; glows only on the active card, the progress bar, and the
best-move arrow; everything else flat.

### Blush studio (light theme)

```
Backgrounds       --bg: #faf6f0          warm ivory (never stark white)
                  --surface-1: #f4eee6   panels (soft beige)
                  --surface-2: #fffdf9   cards, inputs (cream)
                  --surface-3: #efe6da   hover/raised
Text              --text: #3d3733        warm ink
                  --muted: #8a7f76      secondary (warm gray)
                  --faint: #b3a89e      hints, coords
Accent            --accent: #b56576      dusty rose — deep enough for text contrast
                  --accent-soft: #b5657622  tints
Grades (gentle)   --best: #5f9c7e  --excellent: #7fae92  --good: #9db07c
                  --inacc: #cf9d5f  --mistake: #c97f5d  --blunder: #bf6767
                  (sage → soft amber → terracotta → muted rose-red; same semantic
                   order as midnight, softened saturation)
Board             --sq-light: #f0e4d4 (cream)  --sq-dark: #b79992 (rosy taupe)
                  --sq-sel: #e5c37a (soft gold)
Pills             same tint technique (12% bg of grade color) — reads gentle on cream
Shadows           warmer + lighter: 0 6px 18px rgba(120,90,70,.12)
Glows             replaced by soft shadows — glow effects are midnight-only
```

Design intent: gentleness comes from warmth and low visual noise, not low contrast —
body text stays ≥4.5:1 on every surface. One accent per theme; grade colors are the
only rainbow. All themes share identical spacing, radius, type, and motion —
switching themes never moves a single pixel.

## 1b. Theme system

### Schema

A theme is a plain object of ~22 color tokens plus metadata:

```js
{ id: "midnight", name: "Midnight Club", base: "dark", builtin: true,
  colors: { bg, surface1, surface2, surface3, text, muted, faint,
            accent, accentSoft, best, excellent, good, inacc, mistake, blunder,
            sqLight, sqDark, sqSel, sqHint, danger, success, shadow } }
```

Themes are applied by JS setting CSS custom properties on `:root`
(`style.setProperty`) — not static CSS blocks — so user-defined themes work with the
identical mechanism as built-ins. Component CSS references only the variables.

### Built-in themes (8)

Dark:
- **Midnight Club** *(default dark)* — near-black blue, periwinkle accent, glowing.
- **Deep Forest** — green-charcoal (#101613 family), moss/fern accent (#7fbf8e),
  wooded board (deep olive/cream squares). Cozy cabin-at-night.
- **Charcoal Ember** — warm gray-black (#141210 family), ember copper accent
  (#e08b5a), warm-stone board. Fireside.
- **Ocean Night** — deep navy (#0c1420 family), aqua-teal accent (#5ecfc4),
  slate-blue board. Cool and calm.

Light:
- **Blush Studio** *(default light)* — warm ivory, dusty rose accent, rosy-taupe
  board. As speced above.
- **Lavender Studio** — cooled ivory, muted lavender accent (#82709f), gray-mauve
  board. As mocked.
- **Sage Morning** — warm white with a green undertone (#f6f8f3 family), sage accent
  (#6e9b7d), soft olive/cream board. Botanical, fresh.
- **Paper & Ink** — neutral crisp off-white (#f7f6f3 family), slate-blue accent
  (#5b7290), classic gray board. The minimalist option.

All eight reuse the same two grade-color sets: the lively set on dark bases, the
gentle set on light bases — consistency in what grade colors *mean* across themes.

### Mode & assignment model

```js
themePrefs = {
  useSystem: true,        // DEFAULT ON: follow prefers-color-scheme
  lightTheme: "blush",    // which theme "light" means
  darkTheme: "midnight",  // which theme "dark" means
  manualMode: "dark",     // used only when useSystem is false
}
```

- `useSystem: true` → OS light/dark picks `lightTheme` / `darkTheme` live (listens
  to the media query, switches without reload).
- The topbar sun/moon button flips mode instantly (sets `useSystem: false` +
  `manualMode`); the settings drawer's Appearance section can re-enable "Use system
  setting" and holds the two assignment dropdowns, each listing every theme of the
  matching base (built-in + custom) with a small color-dot preview strip.
- Prefs persist in `localStorage`; a tiny inline `<head>` script applies the correct
  theme before first paint (no flash of wrong theme).

### User-defined themes

- Any theme has a **Duplicate** action → editable copy ("Midnight Club (copy)").
- The theme editor (inside the settings drawer) shows grouped color inputs —
  Backgrounds, Text, Accent, Grades, Board — using native `<input type="color">`,
  applied live to the whole app as you tweak. Name field, base (light/dark) choice,
  Save / Delete.
- A contrast checker warns inline when text-on-surface pairs fall below 4.5:1
  (warns, doesn't block — user's machine, user's rules).
- Storage: custom themes + prefs saved via `CMT.storage` (sessions store, key
  `"themes"`), mirrored to `localStorage` for the pre-paint script. Included in
  export/import backups (one small addition to `buildExport`/`applyImport` in core —
  the only core change in this overhaul, covered by a new test).
- Custom themes appear in the assignment dropdowns alongside built-ins and can be
  set as the light or dark assignment like any other.

## 2. Layout

### Desktop (≥900px) — three zones

```
┌──────────────────────────────────────────────────────┐
│ topbar: logo · username pill · lookback · Analyze ▶  │
├──────────────┬───────────────────────────────────────┤
│ position     │  trainer panel                        │
│ list (rail)  │  big board · feedback · history       │
│ 380px        │  fluid                                │
└──────────────┴───────────────────────────────────────┘
```

- **Topbar** replaces the settings panel as the primary surface: username, lookback,
  and a prominent Analyze button. Everything else (depth, thresholds, phases, book,
  max games) moves into a **settings drawer** that slides from the right, opened by a
  gear icon. Filters (sort, skip-first-N, ignore book, show all) become a compact
  **filter row** at the top of the list rail.
- **List rail** is independently scrollable; the trainer panel is sticky so the board
  stays put while browsing cards.
- **Trainer panel**: board ~min(52vh, 480px), feedback banner directly under the
  board (where the eye lands after moving), history table below, "My lines" and
  export/import tucked into the drawer.

### Mobile (<900px) — stack navigation

- Single column: topbar (condensed) → filter chips (horizontally scrollable) →
  position cards.
- Tapping a card pushes a **full-screen trainer view** with a slide-up transition:
  board sized to `min(100vw - 24px, 55vh)`, feedback below, history as cards rather
  than a table, sticky bottom action bar (Best move · Reset · Back).
- Back via ⌫ button and swipe-right affordance; browser back button also works
  (pushState) so it feels native.
- All tap targets ≥44px; the settings drawer becomes a full-screen sheet.

## 3. Components

**Position card** (the star of the app — make it gorgeous):
- Mini-board thumbnail 72px with rounded corners, oriented to the user's color.
- Line 1: opening name (accent color) + move badge ("Move 7").
- Line 2: "You played **Bb4** 6/8×" + grade pill.
- Line 3: a thin **severity bar** — fill = badShare, color = worst grade color. This
  replaces text-only "bad 75%" with an instant visual read.
- Pills: filled tints (12% bg of grade color, colored text) instead of outlines —
  livelier, easier to scan. Book pill = accent tint; Ignored = neutral tint.
- Selected card: accent border + soft outer glow + 2px scale pop (220ms overshoot).

**Board**:
- Keep DOM-grid rendering but upgrade pieces from text glyphs to **SVG pieces**
  (single inline sprite, cburnett-style outlines) — the biggest single visual upgrade
  available. Fallback to glyphs if the sprite fails.
- Last-tried move highlighted; legal-move dots slightly larger on touch devices;
  drag *and* tap-tap both supported (drag is pointer-events based, additive — the
  existing tap-tap path stays as the tested fallback).
- Best-move arrow: accent color with soft glow, animated draw-in (120ms).

**Feedback banner**: colored left border + tint by outcome, grade word large, cp loss
and best move inline. On "Best!" — a brief confetti-free flourish: the banner pops
and the grade pill pulses once. Inviting, not noisy.

**Progress**: slim accent bar under the topbar (YouTube-style) plus status text in the
list rail's empty state while analyzing. Engine/book phases get distinct labels.

**Empty states** (first-run especially — this is the "inviting" moment):
- Before first analysis: a friendly hero in the list rail — small illustrated board,
  "Find the moves you keep getting wrong", one-line explanation, big Analyze button.
- No flags: celebratory tone ("Nothing repeatedly wrong in this window — lower the
  thresholds or widen the lookback to dig deeper.")

**Settings drawer**: grouped sections (Analysis · Grading & phases · Opening book ·
My lines · Data) with the existing inputs restyled; "My lines" list lives here with
its paste box. Export/import/clear become buttons in the Data section.

## 4. Interaction & motion details

- Card hover: raise to --surface-3 + border-strong (120ms). Selection: pop + glow.
- Trainer transitions: mobile push = translateX slide (220ms); desktop selection =
  crossfade of the detail panel only (no layout shift).
- Retry flow: after a wrong answer, auto-offer "Try again" and "Show best"; after
  Best, auto-advance affordance ("Next position →") to make drilling feel like a
  streak. (Pure UI — reuses existing analyzeMove.)
- Number transitions (bad %, cp) animate with a 200ms count-up on selection.
- prefers-reduced-motion honored everywhere.

## 5. Accessibility

- Full keyboard support: ↑/↓ moves through cards, Enter opens, B = show best,
  R = reset. Focus rings in accent color, visible on dark.
- Grade pills always pair color with text (already true — keep it).
- Contrast: all text ≥4.5:1 against its surface (tokens above chosen for this).
- aria-labels on icon buttons; aria-live on the feedback banner and status line.

## 6. Implementation phases

Each phase ships working and ends with `npm test` + a manual smoke pass
(analyze → select → retry → ignore → export/import).

1. **Theme engine & shell** — theme registry (themes.js), variable application,
   pre-paint script, prefs model, topbar, settings drawer with Appearance section,
   filter row. All 8 built-in themes ship here.
2. **Position cards & list rail** — new card markup, severity bar, pills, empty
   states, keyboard navigation.
3. **Trainer panel** — board sizing, SVG pieces, feedback banner, history cards,
   arrow polish, streak affordances.
4. **Mobile navigation** — stack view, pushState back handling, bottom action bar,
   touch drag on the board.
5. **Motion & polish** — transitions, count-ups, reduced-motion, focus states,
   cross-browser pass (Safari included — it's the pickiest here).
6. **Theme editor** — duplicate/edit/save/delete custom themes, live preview,
   contrast checker, backup integration (the one small core.js addition + test).

## 7. What must not change (the contract)

- All calls go through the existing `CMT` API; no logic in the UI layer.
- Settings object shape produced by `readSettings()` stays identical.
- Element IDs may change freely **except** none of core.js references the DOM — so
  the only true contract is CMT + the data model in core.js's header comment.
- `npm test` must stay green (it will — core is untouched).
- Single-file, no build step: keep vanilla HTML/CSS/JS so deploy stays "three files
  on any static host".
