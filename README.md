# Chess Mistake Trainer

A single-page app that pulls your Chess.com games, analyzes every move you made with
Stockfish, groups them by **unique position**, and surfaces the positions where you
repeatedly go wrong — so you can spot patterns like *"in the Owen's Defense I play the
wrong 7th move 80% of the time"* and drill them.

Everything runs in your browser. No install, no server, no account. Games come from
Chess.com's public API; the engine (Stockfish) runs locally via WebAssembly.

## Run it

Open `index.html` in a browser (double-click it, or drag it into a tab). That's it.

An internet connection is needed the first time so the browser can download the
Stockfish engine and the chess library from a CDN, and to fetch your games.

## Use it

1. Enter your **Chess.com username** (defaults to `your-username`).
2. Set the **lookback** (default 90 days), **max games** (0 = unlimited — the lookback
   window still caps it), how far into each game to
   analyze (**analyze up to move #**, default 16 — openings/early middlegame), and the
   engine **depth** (default 12; higher = more accurate but slower).
3. Click **Fetch & Analyze**. Progress shows live; hit **Stop** any time to view
   partial results.
4. The left column lists **problem positions**, worst/most-frequent first. Each card
   shows the opening, the move number, what you usually played and its grade, how often
   it was bad, and the engine's best move.
5. Click a card to open it on the right: an interactive board set to that position.
   Make a move to see how it grades versus the engine, hit **Show best move** for an
   arrow, and see a table of every move you've historically tried there.

## How a "mistake" is decided

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

## Files

- `index.html` — layout and controls
- `styles.css` — styling
- `app.js` — fetching, PGN parsing, engine, analysis, board, and UI
