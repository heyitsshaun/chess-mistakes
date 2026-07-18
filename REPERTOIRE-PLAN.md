# Plan: Repertoire mode (course-line comparison as the main mode)

> Status: **implemented** (July 2026). User-facing docs: `REPERTOIRE_MODE.md`.
> This file is the original design plan, kept for reference.

Games are compared against imported course trees (Chessly crawls or custom
lines) instead of engine+book analysis. Engine is used ONLY to grade the ~N of
my moves after an opponent deviation. Existing engine/lichess pipeline becomes
"Legacy mode" behind a toggle. Old single-active-line comparison panel is
removed (superseded).

## 1. Course data & import

- **`chessly-import/build_courses_bundle.py`** — reads every `*-raw.json`,
  emits **`courses-data.js`** (repo root, loaded via script tag so file://
  works): `window.CMT_COURSES = [{id, name, shortName, color: 'w'|'b',
  chapters, studies, positions: {posKey → {moves: [{san, uci, studyIds}]}}}]`.
  - Course color from `courseMeta.color` ('W'/'B'), fallback to tags.
  - Chessly FENs (with move counters + old-style ep) normalized to the app's
    existing `posKey()` form at build time, so transpositions and ep quirks
    match the game-side keys exactly.
- **Import UI** (settings → Courses): add more courses at runtime — raw
  chessly JSON via file picker, or pasted PGN/SAN lines as a "custom course"
  (name + color). Stored in IndexedDB, merged with the bundle (same id in
  IndexedDB overrides bundle). Remove supported. Courses included in
  export/import backups.

## 2. Core logic (core.js — no DOM, tested)

- `buildRepertoire(courses, myColor)` → `Map(posKey → {uci → {san, courseIds}})`.
- `classifyGame(game, repertoire, {windowSize, maxMove})` — walk the game:
  - Both sides' moves looked up by posKey. In book → continue.
  - **I leave book first** → `{type:'user-dev', posKey, fenBefore, moveNo,
    played, expected[], courseIds, multiCourse}`.
  - **Opponent leaves book first** → `{type:'opp-dev', posKey (after their
    move), theirMove, courseIds, window: my next ≤N moves with fens}`.
  - Book line simply ends (position has no course moves) → `'book-end'`, not
    a deviation. Game never in book / wrong color → `'unmatched'`.
  - Course attribution: single course named per deviation (deepest surviving;
    ties broken arbitrarily) with a `multiCourse` flag → ⚠ marker in UI.
- `runRepertoireAnalysis(games, settings, deps)`:
  - Classify all games (instant, no engine).
  - **User-dev aggregation**: by posKey — expected course move(s), my tried
    wrong moves with counts (`plays`), occurrence total, deviation share.
    Same shape as legacy `Position` so list/drill code can render it.
  - **Opp-dev aggregation**: group by posKey after the opponent's deviating
    move (identical deviations across games collapse). Engine-grades every
    window move (existing `analyzeMove`, existing eval cache & depth setting)
    — a handful of evals per game, with progress + stop support.
- Persistence: `courses` IndexedDB store; repertoire results in the session
  autosave; export format v3 (mode, courses, both result sets).
- Tests (`test/core.test.js`): classifyGame fixtures — user-dev, opp-dev,
  book-end vs deviation, transposition into book, multi-course attribution,
  window truncated by game end, maxMove cap; bundle FEN normalization (ep).

## 3. UI (app.js / index.html)

- **Mode toggle** (topbar): Repertoire (default) | Legacy. Legacy path
  untouched. Old comparison panel + its settings UI deleted.
- **Run flow** (repertoire): fetch games exactly as today (API or PGN files)
  → classify → engine pass over opp-dev windows with progress bar → render.
- **List rail**: filter chips `All | I deviated | Opponent deviated`
  (both visible under All, mixed sort by frequency).
  - User-dev card: mini board, course name (+⚠ if multiCourse), expected
    move, what I play and how often, deviation rate.
  - Opp-dev card: mini board at their deviating move, that move, times seen,
    summary of my graded responses (worst grade + avg cpl highlighted).
- **Detail panel**: board at the deviation.
  - User-dev: course move = the "answer" (arrow on reveal), table of my
    tried moves, study/chapter names shown (from course data).
  - Opp-dev: step through my window moves with grades; per-position engine
    best as the answer; practice mode = board at any window position.
- **Drill / shuffle**: reuse existing drill machinery. Pool = flagged
  user-dev positions + opp-dev window positions where I was graded below
  threshold. Answer check = course move (user-dev) / engine best (opp-dev).
  Existing min-occurrence, round-size, no-repeat shuffle config applies;
  new filter for which deviation types to include.
- **Settings**: window size N (default 5), reuse engine depth for the window
  pass, course manager (list, color badge, line counts, import/remove).

## 4. Docs & cleanup

- README: new "Repertoire mode" section, legacy mode note.
- COMPARISON_MODE.md: header marked superseded/legacy, kept for reference.
- REPERTOIRE_MODE.md: user-facing doc of the new mode.

## Build order

1. `build_courses_bundle.py` + `courses-data.js` (verify all 5 courses)
2. Core: repertoire module + tests green
3. UI: mode toggle, run flow, list/detail
4. Drills integration
5. Course import UI + persistence + export v3
6. Docs, remove old comparison UI, full `npm test` + smoke run
