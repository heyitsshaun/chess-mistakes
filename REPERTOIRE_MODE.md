# Repertoire mode

The default mode. Instead of grading every move with an engine, each game is
compared to your **courses** — full opening trees (typically crawled from
Chessly) that say, for every covered position, which moves the course plays
for you and which opponent replies it prepares you for.

## What a run produces

Every analyzed game is walked from move 1 against all courses matching the
color you played, until the first departure from the tree:

- **I deviated** — you played a move the course doesn't. Aggregated by
  position: what the course plays, everything you've played instead (with
  counts), and your off-book rate at that position. Games where you played the
  course move through the same position count toward the denominator, so a
  card reading "off-book 40% of 5 visits" means you got it right 3 times.
  The course is the answer key for flagging and drills; on top of that, each
  deviating move is engine-graded in the background — the card and the
  "what you played instead" table pick up a grade, avg cp loss, and the
  engine's preferred move as the pass reaches them. Grading never blocks
  anything: cards render instantly and fill in.
- **They deviated** — your opponent left the course first. Identical
  deviations (same resulting position) are grouped across games, because
  opponents often break your prep in the same way and you may have grooved a
  bad response. Your next **N moves** after the deviation (Settings →
  Repertoire courses → default 5) are graded with Stockfish; flagged replies
  show up on the card and in drills. This is the only engine use in the mode,
  so runs are fast and mostly offline.
- **In book** — the game stayed inside the course until its lines ran out.
- **Unmatched** — you had no course for that color, or the game wasn't yours.

On top of the per-game classification, every run also collects **Outside
lines**: your most common positions not covered by any course — everything
after a game leaves the tree (your deviation, theirs, or the course simply
running out), excluding positions that transpose back into a course.
Aggregated across games up to a configurable move number (Settings →
Repertoire courses → "Track positions outside lines up to move", default 20)
and sorted by frequency, each card shows how often you reach the position,
your score there, and — once the background engine pass gets to it — the
grade of what you played plus the engine's best move. It's the "what happens
once I'm out of prep" view: pick the **Outside lines** filter to see it.

The status line after a run reports all the counts.

## Reading the list

- Filter chips: **All deviations / I deviated / Opponent deviated /
  Outside lines** (the last is its own view — off-line positions aren't
  deviations, so "All deviations" doesn't include them; they flag on
  frequency alone, so `min times seen` is the lever there).
- "Show all" reveals cards below the flag thresholds (min times seen, flag
  share — same settings as Engine mode, applied instantly).
- ⚠ *multi* on a card: the position exists in more than one of your courses;
  one of them is named. The expected-move list is the union.
- Clicking an "I deviated" card gives you the board to replay: the course
  move(s) are the answer. Clicking a "They deviated" card shows the position
  after their off-book move, your graded replies over the window (click a row
  to load that later position), and lets you retry against the engine.

## Extras

- **Intentional deviations**: on an "I deviated" panel, mark a move as
  *intentional* — moves you play on purpose stop counting against you (same
  mechanism as manual ignores; persists, exports, reversible).
- **Explore button**: any deviation panel deep-links into the line explorer
  at that exact position (for opponent deviations, including their off-book
  move) so you can see the surrounding tree and games.
- **Study labels**: panels show which Chessly chapter/study covers the
  position, with a link to the course.
- **Summary strip** above the list: games, % in book, deviation counts,
  overall score, and your single worst leak.
- **Course filter** beside the deviation filter narrows the list to one course.
- **Drill these**: an opponent-deviation panel can spin up a mini-drill of
  just your replies to that deviation.

## Drills

Shuffle drill pools all three kinds: your deviations (answer = any course
move at that position, checked instantly), flagged post-deviation replies,
and off-line positions where you erred (both: answer = engine best, graded
live). With the **Outside lines** filter active, the drill draws from just
those positions. The same min-occurrences / mistake-rate / round
size / no-repeat mechanics apply. Outcomes persist across sessions:
**focus weak spots first** leads each round with positions you failed or
haven't drilled, and the round summary lists your misses with jump-to-review
buttons.

## Managing courses

Settings → **Repertoire courses**:

- Five Chessly courses ship bundled in `courses-data.js`. Remove any (and
  restore them later); removal survives reloads.
- **Import Chessly crawl** — load a `chessly-*-raw.json` produced by
  `chessly-import/chessly-crawler.js` (see `chessly-import/TASK-SPEC.md` for
  the 10-minute crawl procedure for a new course).
- **Paste lines** — build a custom course from SAN lines or a PGN, one line
  per row. Pick which color the repertoire is for; both sides' moves become
  part of the tree (your moves = answers, opponent moves = "prepared" replies).
- Imported courses persist in browser storage, are included in backups, and
  survive "Clear saved cache".
- To bake new crawls into the bundle instead:
  `python3 chessly-import/build_courses_bundle.py`.

## Notes

- Matching is by position (transposition-friendly), not move order. A game
  that transposes into a course line mid-opening is treated as in-book from
  the position where it joins.
- Course color matters: as White only your White courses apply, and vice
  versa. A game where your first move already leaves all your courses counts
  as "I deviated" at move 1.
- Engine mode (the original per-move Stockfish analysis) is unchanged and one
  click away in the top bar; each mode keeps its own results, and both are
  saved/exported together.
