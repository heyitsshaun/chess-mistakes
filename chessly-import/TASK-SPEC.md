# Task spec: Extract a Chessly course as PGN

Extract every line of a Chessly opening course into (a) a raw JSON of the
position graph and (b) a PGN with nested variations. Works for any course the
user has access to.

## Prerequisites

- User logged into chessly.com in Chrome
- Course ID (the UUID in `https://chessly.com/courses/<COURSE_ID>`)
- Python 3 with `python-chess` installed (`pip install python-chess`)

## How it works (background)

Chessly's course explorer calls
`GET https://cag.chessly.com/beta/openings/courses/<COURSE_ID>/positions/studies?fen=<urlencoded FEN>`
(auth via the site's cookies). The response is
`{ "moves": ["e4", ...], "studies": [{id, chapterId, name}, ...] }` — the
course moves playable from that position, and the studies containing it.
BFS from the starting position over this endpoint recovers the whole tree.

## Steps

1. Open Chrome on `https://chessly.com/courses/<COURSE_ID>` (must be logged in).
2. Run `chessly-crawler.js` in that page's context — either paste it into the
   DevTools console (easiest, no agent needed), or have an agent execute it
   with a browser JavaScript tool.
3. Wait for completion (a 1,200-position course takes ~3–5 minutes). It logs
   progress and finishes by downloading `chessly-<name>-raw.json`.
4. Move the JSON next to `chessly_to_pgn.py` and run:
   `python3 chessly_to_pgn.py chessly-<name>-raw.json`
5. Sanity-check the printed stats: `missing positions` must be 0, errors 0,
   and the PGN should parse (the script's leaf count should be stable if you
   re-run the crawl).

## Critical gotchas (learned the hard way)

- **Exact FEN matching, old-style en passant.** The API matches FENs as exact
  strings, and Chessly always writes the ep square after a double pawn push
  (e.g. `... b KQkq e3 0 1`), while chess.js/python-chess default to `-`
  unless a capture is possible. Query with the wrong ep field and you get
  `{"moves": []}` — a silent wrong answer, not an error. The crawler patches
  this; `chessly_to_pgn.py` uses `board.fen(en_passant="fen")`.
- **Rate limiting.** ~6 parallel uncapped fetches caused `Failed to fetch`
  errors. 3 workers + 60 ms delay + retry-with-backoff ran clean.
- **Agent-specific:** the Chrome javascript tool truncates return values at
  ~1 KB and times out at 45 s. Run the crawler fire-and-forget (don't await
  it in the tool call), poll `window.__crawlState` for progress, and export
  via the file download — never try to return the JSON through the tool.
- chess.js is imported from jsdelivr CDN inside the page; chessly.com's CSP
  allows this today.

## Outputs

- `chessly-<name>-raw.json` — `{course, courseMeta, chapters, startFen,
  studies: {id → {name, chapterId}}, positions: {fen → {m: [SAN moves],
  s: [study ids]}}}`. `courseMeta` and `chapters` are the verbatim responses
  from `GET /beta/openings/courses/<id>` and `.../chapters`. Keep this file:
  it has the full study/chapter↔position mapping for per-study PGNs later.
- `chessly-<name>.pgn` — single game, full tree as nested variations, leaf
  comments like `Chapter 7: Anti-London / Study 1: A System Against the
  London`. Imports into Lichess/ChessBase.

Note: the per-position endpoint returns ONLY `{moves, studies}` — there is no
per-move variation-name metadata to capture. The chapter/study labels shown in
the Course Explorer UI are assembled client-side from the `/chapters` response
plus the `studies` array; the crawler now captures both raw.

## Reference result (Owen's Defense course, b094bf9e-a914-4a41-a3b1-d0c921636166)

1,193 positions, 187 lines, max depth 40 plies, 0 errors.
