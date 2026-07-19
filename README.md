# Chess Mistake Trainer

A single-page app that pulls your Chess.com games and finds where they depart from
your opening preparation. It has two modes, switchable in the top bar:

- **Repertoire (default)** — compares every game to your opening courses (crawled
  from Chessly or pasted by hand) and splits the results into games where **you left
  your prep first** and games where **your opponent left it first** — then engine-
  checks how you handled the moves right after their deviation.
- **Engine (legacy)** — the original pipeline: grade every move with Stockfish,
  group by unique position, surface the positions you repeatedly get wrong.

Everything runs in your browser. No install, no server, no account. Games come from
Chess.com's public API; the engine (Stockfish) runs locally via WebAssembly.

## Run it

Open `index.html` in a browser (double-click it, or drag it into a tab). That's it.

An internet connection is needed the first time so the browser can download the
Stockfish engine and the chess library from a CDN, and to fetch your games.

## Repertoire mode (default)

Five Chessly courses ship bundled (`courses-data.js`): Owen's Defense, The Gotham
Dutch, The Gotham Gambit, The London System, The Trompowsky Attack. Manage them —
and add your own via a Chessly crawl file or pasted lines — under **Settings →
Repertoire courses**. See `REPERTOIRE_MODE.md` for the full guide and
`chessly-import/TASK-SPEC.md` for how to crawl another course.

1. Enter your **Chess.com username** and lookback, hit **Analyze**.
2. Each game is walked against every course for the color you played until someone
   leaves the tree:
   - **I deviated** cards: the position where you went off-book, what the course
     plays, what you played instead, and how often (correct pass-throughs count in
     the denominator). No engine involved — the course is the answer key.
   - **They deviated** cards: identical opponent deviations are grouped; your next
     ~5 moves (configurable) are graded with Stockfish, so you can see whether their
     "random" sidestep provokes the same bad reply from you every time.
   - Games that stay inside the course to the end of its lines count as in-book.
3. Filter the list with **All / I deviated / Opponent deviated**; click a card to
   retry the position on the board (course move or engine-best as the answer).
4. **Shuffle drill** works on both kinds: course-move drills for your deviations,
   engine-best drills for the flagged post-deviation replies.

A ⚠ *multi* tag means the position exists in more than one of your courses; the
card names one of them.

### Win %, games, and the game viewer

Every moves table shows a **win %** per move (draws count half; hover for
W/D/L) and a **games** button that drills into the exact games where you
played it. Click a game to step through its moves on the board (the viewer
jumps to the relevant position), then navigate back up. Works in both modes.

### Line explorer

**Line explorer** (next to Shuffle drill) walks a course tree chessly-style:
pick a course, click through its moves (or play on the board), and at every
position see the course's continuations, which games of yours reached it,
your score there, every move actually played there (in-line vs off-book), and
— when it's your move — *"you deviate from the line when playing this
position X% of the time"*. Any games list clicks through to the viewer.
Keyboard: ←/→ step the game viewer, ← backs up the explorer, Esc goes up a
level. Copy-FEN / copy-line buttons at the bottom; every deviation panel has
an **Explore** button that deep-links here.

### Course-line overlay

On any deviation panel, **Course line** (next to *Show course move*) pops the
course's line to that position in an overlay — course title up top, the moves
that led there as a rewindable strip (←/→ or the ⏮ ← → ⏭ buttons), and the
course's continuations from wherever you step to. For opponent deviations the
last move is highlighted as their off-book move. **Open in explorer** jumps to
the full line explorer at the same spot; Esc closes.

### Favorites

Every position card (and detail panel) has a ☆ star. Starred positions persist,
survive *Clear saved cache*, and travel with export/import. Filter the list
with the **★ only** chip, and check **Favorites only** in the drill setup to
drill just your starred positions.

### Drill stats

**Drill stats** (next to *Line explorer*) shows what you're improving in:
per-position drill history (result dots for your last attempts, score, and an
improving / steady / slipping trend), overall first-try rate, recent rounds vs
earlier ones, sortable by most drilled / still struggling / most improved.
Click a row to open that position.

Under the hood every finished drill round is appended to a persistent log
(one immutable record per round in IndexedDB, `dlog:*` keys), and all
aggregation happens at read time (`CMT.drillMetrics`) — so the stats UI can be
reshaped later without migrating stored data. The log survives cache clears
and is included in backups.

### Background engine grading

Results render the moment games are loaded (counts and win % need no engine).
Stockfish grades fill in progressively in the background — opening a position
bumps it to the front of the queue — and everything re-renders as grades
arrive. Stop halts the background pass; it resumes on the next run/reload.

## Engine mode (legacy)

1. Enter your **Chess.com username**.
2. Set the **lookback** (default 90 days), **max games** (0 = unlimited — the lookback
   window still caps it), how far into each game to
   analyze (**analyze up to move #**, default 16 — openings/early middlegame), and the
   engine **depth** (default 12; higher = more accurate but slower).
3. Click **Analyze**. Progress shows live; hit **Stop** any time to view
   partial results.
4. The left column lists **problem positions**, worst/most-frequent first. Each card
   shows the opening, the move number, what you usually played and its grade, how often
   it was bad, and the engine's best move.
5. Click a card to open it on the right: an interactive board set to that position.
   Make a move to see how it grades versus the engine, hit **Show best move** for an
   arrow, and see a table of every move you've historically tried there.
6. Click **Shuffle drill** to practice a randomized round without repeats. Set the
   minimum times a position must have appeared, the minimum mistake rate, and an
   optional round size. The drill hides the move history and engine answer until you
   make an attempt or reveal it.

## How a "mistake" is decided (Engine mode)

Each of your moves is compared to Stockfish's best move in that position. The
difference, in **centipawns lost**, is graded:

| Grade | Default cp loss |
|-------|-----------------|
| Best | ≤ 10 (or exactly the engine's move) |
| Excellent | ≤ 25 |
| Good | ≤ 50 |
| Inaccuracy | ≤ 100 |
| Mistake | ≤ 200 |
| Blunder | worse |

Because you care about different standards at different stages, grading is **phase
aware** (all editable under *Advanced*):

- **Opening** (moves 1–8): flagged unless the move is *Excellent* or better.
- **Middlegame** (through move 25): flagged unless *Good* or better.
- **Endgame** (after): flagged unless *Inaccuracy* or better.

A position is flagged when your bad-move share meets the **flag share** (default 50%)
and it's been seen at least **min times** (default 1). Raise *min times* to 2–3 to
focus only on recurring patterns.

Two kinds of exemptions keep sound-but-engine-disliked moves from being flagged:

- **Opening book** (toggle: *ignore book moves*): moves through move 12 (configurable)
  are checked against the Lichess opening explorer — established theory (≥1% of master
  games, or ≥2% of 1600–2200 games when masters data is thin) is never flagged and
  shows a blue *Book* pill. Lookups are cached permanently.
- **My lines** (in the controls): your personal repertoire. Paste a line in algebraic
  notation and every position→move in it is exempted — for offbeat lines you play on
  purpose that no book contains. You can also click *ignore* next to any move in a
  position's history table. These always apply, survive reloads and cache clears, and
  are included in export/import.

The list header also has **skip first N moves**, a view-only filter that hides
early-move positions without affecting analysis. Thresholds, phases, and toggles all
apply instantly on change — no re-analysis needed.

## No games showing up? (CORS)

If the browser can't reach Chess.com (some networks/extensions block it), use
**Load PGN file**: on chess.com go to your archive, download your games as a `.pgn`,
and load the file(s) here. You can select multiple files. Everything else works the same.

## Save / resume

Everything persists automatically in browser storage (IndexedDB):

- **Engine evals** are cached by position + depth and survive page reloads. Re-running
  the same games at a previously used depth is nearly instant, and each depth keeps its
  own cache, so switching depths never throws work away.
- **Your last analysis** is auto-saved and restored when you reopen the page.
- **Clear saved cache** wipes both if you want a fresh start.

**Export results** / **Import results** additionally let you save the analysis to a
JSON file — useful for backups or moving between browsers. Note browser storage is
per-browser-per-site; if you later deploy this with a backend, the storage layer in
`app.js` (`idb`) is the one thing to reimplement (e.g. against SQLite).

## Notes & limits

- Only standard chess games are analyzed (variants are skipped).
- In-browser Stockfish at depth 12 is fast and good enough to catch real errors, but
  it is not as deep as a full server analysis. Bump the depth for more precision.
- Positions are grouped ignoring the move-clock, so the same position reached via
  different move orders (or in different games) is counted together.

## Interface

Chess pieces default to lichess's open-source **cburnett** set (fetched once
from a CDN, cached for offline use; the built-in geometric "classic" set is
the fallback). Settings → Appearance switches sets or loads your own: upload
12 SVG/PNG files named `wK wQ wR wB wN wP bK bQ bR bB bN bP`.

The UI ships with 8 built-in themes — dark: Midnight Club (default), Deep Forest,
Charcoal Ember, Ocean Night; light: Blush Studio (default), Lavender Studio, Sage
Morning, Paper & Ink. By default the app follows your system light/dark preference
(dark → Midnight Club, light → Blush Studio); the sun/moon button in the topbar
overrides it, and Settings → Appearance lets you reassign which theme "light" and
"dark" mean, duplicate any theme, and edit your copy with live preview (with an
inline contrast warning). Custom themes persist and are included in backups.

Layout: desktop gets a position list rail beside a sticky trainer panel; on phones
tapping a card opens a full-screen trainer with a bottom action bar (browser back
closes it). The board supports tap-tap and drag. Keyboard: ↑/↓ browse positions,
B shows the best move, R resets, Esc closes panels; during a shuffled drill, N or ↓
advances. All settings live in the gear
drawer; analysis controls (player, days, Analyze) stay in the topbar.

## Architecture

The app is split so the UI can be overhauled without touching (or breaking) the logic:

- `core.js` — **all logic, zero DOM.** Fetching, PGN parsing, the Stockfish engine
  wrapper, move grading, position aggregation, book/custom-line exemptions, the
  repertoire module (course management, game classification, deviation
  aggregation), and persistence. Exposed as `window.CMT` in the browser and via
  `module.exports` in Node. The data model (Settings, UserMove, Position, Play,
  Course, RepResults) is documented at the top of the file.
- `courses-data.js` — generated bundle of course trees (do not edit; regenerate
  with `python3 chessly-import/build_courses_bundle.py` after adding crawls).
- `themes.js` — theme engine: built-in + custom themes applied as CSS variables,
  system-preference mode, light/dark assignments, persistence and backup mirror.
- `pieces.js` — piece-set manager (cburnett CDN fetch + cache, custom uploads,
  classic fallback).
- `views.js` — the drill-down views (games list, game viewer, line explorer),
  split from app.js; loaded after it and sharing its top-level scope.
- `app.js` — **thin UI layer.** Reads settings from inputs, renders the list/board/
  detail panels, wires events. Everything it does goes through the `CMT` API.
- `index.html` / `styles.css` — layout and styling.
- `test/core.test.js` — test suite for the core (52 tests, no framework), and
  `test/ui.smoke.js` — a jsdom smoke test that boots the whole app and exercises
  the repertoire flow end-to-end. Run both with `npm install` then `npm test`.
  **When changing the UI, a green test run means the core still behaves** — the
  UI's only obligations are the CMT API and element IDs it chooses itself.
- `chessly-import/` — tooling for crawling Chessly courses (crawler script, PGN
  converter, bundle builder, task spec) plus the raw crawl files.

Under-the-hood behavior worth knowing:

- Engine eval writes are **batched** into single IndexedDB transactions (flushed every
  50 evals / 800 ms / on tab close) instead of one transaction per move.
- A hung engine eval **times out after 60 s**, the worker is auto-restarted, and the
  move is skipped; five consecutive failures abort the run with partial results kept.
- Position keys drop the en-passant field unless an ep capture is actually possible,
  so identical positions reached via different move orders group together. Keys are
  re-derived from FENs whenever results are loaded from storage or an import file.
