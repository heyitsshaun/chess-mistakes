/* Test suite for core.js — run with `npm test` (or `node test/core.test.js`).
 * No framework: plain assertions. Covers the logic the UI depends on, so a UI
 * overhaul can be validated by running this suite.
 */
"use strict";
const assert = require("assert");
const CMT = require("../core.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n      " + e.message); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n      " + e.message); }
}

// Default thresholds/phases matching the UI defaults.
const TH = { Best: 10, Excellent: 25, Good: 50, Inaccuracy: 100, Mistake: 200 };
const PHASES = { openEnd: 8, midEnd: 25, accOpen: 1, accMid: 2, accEnd: 3 };
const SETTINGS = {
  username: "tester", maxMove: 60, depth: 12, th: TH, phases: PHASES,
  flagShare: 0.5, minOcc: 1, bookMax: 12,
};

// A realistic chess.com PGN: headers, clock comments, "N..." continuations.
const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "tester"]
[Black "opponent"]
[Result "0-1"]
[ECOUrl "https://www.chess.com/openings/Owens-Defense-2.d4-Bb7"]
[Link "https://www.chess.com/game/live/123"]

1. e4 {[%clk 0:09:58.1]} 1... b6 {[%clk 0:09:57]} 2. d4 {[%clk 0:09:50.3]} 2... Bb7 {[%clk 0:09:55.2]} 3. Nc3 {[%clk 0:09:45]} 3... e6 {[%clk 0:09:52]} 0-1`;

const GAME = {
  pgn: CHESSCOM_PGN, rules: "chess", url: "https://www.chess.com/game/live/123",
  white: { username: "tester" }, black: { username: "opponent" },
};

// Fake engine: evals from lookup tables, no worker, no storage.
function fakeEngine(cpTable, bestTable) {
  return {
    cache: new Map(),
    evaluate: async (fen) => ({
      cp: cpTable[fen] !== undefined ? cpTable[fen] : 0,
      mate: null,
      best: bestTable && bestTable[fen] ? bestTable[fen] : "a2a3",
    }),
  };
}

(async function main() {
  console.log("parsing");

  test("parseMoves strips chess.com clock comments and move numbers", () => {
    const sans = CMT.parseMoves(CHESSCOM_PGN);
    assert.deepStrictEqual(sans, ["e4", "b6", "d4", "Bb7", "Nc3", "e6"]);
  });

  test("parseMoves handles NAGs, variations, results, bare movetext", () => {
    assert.deepStrictEqual(
      CMT.parseMoves("1. e4 $1 (1. d4 d5) e5 2. Nf3 1/2-1/2"),
      ["e4", "e5", "Nf3"]);
    assert.deepStrictEqual(CMT.parseMoves("e4 e5 Nf3"), ["e4", "e5", "Nf3"]);
  });

  test("pgnHeader / openingName", () => {
    assert.strictEqual(CMT.pgnHeader(CHESSCOM_PGN, "White"), "tester");
    assert.strictEqual(CMT.openingName(CHESSCOM_PGN), "Owens Defense 2.d4 Bb7");
  });

  test("gamesFromPgnText splits multi-game files", () => {
    const two = CHESSCOM_PGN + "\n\n" + CHESSCOM_PGN.replace('"tester"', '"other"');
    const games = CMT.gamesFromPgnText(two);
    assert.strictEqual(games.length, 2);
    assert.strictEqual(games[0].white.username, "tester");
    assert.strictEqual(games[1].white.username, "other");
    assert.ok(games[0].url.includes("chess.com"));
  });

  test("extractUserMoves: white user, positions and uci correct", () => {
    const moves = CMT.extractUserMoves(GAME, "TESTER", 60); // case-insensitive
    assert.strictEqual(moves.length, 3); // e4, d4, Nc3
    assert.strictEqual(moves[0].uci, "e2e4");
    assert.strictEqual(moves[0].moveNo, 1);
    assert.ok(moves[0].fenBefore.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"));
    assert.strictEqual(moves[2].san, "Nc3");
    assert.strictEqual(moves[2].moveNo, 3);
  });

  test("extractUserMoves: black user + maxMove cutoff", () => {
    const moves = CMT.extractUserMoves(GAME, "opponent", 2);
    assert.strictEqual(moves.length, 2); // b6, Bb7 (e6 is move 3 > maxMove)
    assert.strictEqual(moves[0].san, "b6");
    assert.strictEqual(moves[0].color, "b");
  });

  test("extractUserMoves: unknown user → empty", () => {
    assert.deepStrictEqual(CMT.extractUserMoves(GAME, "nobody", 60), []);
  });

  console.log("grading & keys");

  test("classify boundaries", () => {
    assert.strictEqual(CMT.classify(0, TH), 0);
    assert.strictEqual(CMT.classify(10, TH), 0);
    assert.strictEqual(CMT.classify(11, TH), 1);
    assert.strictEqual(CMT.classify(25, TH), 1);
    assert.strictEqual(CMT.classify(50, TH), 2);
    assert.strictEqual(CMT.classify(100, TH), 3);
    assert.strictEqual(CMT.classify(200, TH), 4);
    assert.strictEqual(CMT.classify(201, TH), 5);
  });

  test("phaseOf boundaries", () => {
    assert.strictEqual(CMT.phaseOf(8, PHASES).name, "Opening");
    assert.strictEqual(CMT.phaseOf(9, PHASES).name, "Middlegame");
    assert.strictEqual(CMT.phaseOf(25, PHASES).accept, PHASES.accMid);
    assert.strictEqual(CMT.phaseOf(26, PHASES).name, "Endgame");
  });

  test("normScore clamps and handles mate", () => {
    assert.strictEqual(CMT.normScore({ cp: 5000, mate: null }), 1000);
    assert.strictEqual(CMT.normScore({ cp: 0, mate: 3 }), 1000);
    assert.strictEqual(CMT.normScore({ cp: 0, mate: -2 }), -1000);
    assert.strictEqual(CMT.normScore({ cp: -37, mate: null }), -37);
  });

  test("posKey drops uncapturable en-passant squares", () => {
    // After 1.e4: ep square e3 recorded but no black pawn can take.
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    assert.ok(CMT.posKey(afterE4).endsWith(" -"));
    // Same position reached without the double push must produce the same key.
    const noEp = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    assert.strictEqual(CMT.posKey(afterE4), CMT.posKey(noEp));
  });

  test("posKey keeps capturable en-passant squares", () => {
    // 1.e4 c5 2.e5 d5 → white pawn e5 can take d6 en passant.
    const fen = "rnbqkbnr/pp2pppp/8/2ppP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3";
    assert.ok(CMT.posKey(fen).endsWith(" d6"));
  });

  test("posKey ignores half/fullmove counters", () => {
    const a = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const b = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 40";
    assert.strictEqual(CMT.posKey(a), CMT.posKey(b));
  });

  console.log("analysis");

  await atest("analyzeMove: cpl math with perspective flip", async () => {
    const before = "fenA", after = "fenB";
    // Best line keeps +50 for mover; played move leaves opponent at +30
    // (so mover at -30). Loss: 50 - (-30) = 80cp → Inaccuracy.
    const eng = fakeEngine({ [before]: 50, [after]: 30 }, { [before]: "e2e4" });
    const a = await CMT.analyzeMove(
      { fenBefore: before, fenAfter: after, uci: "d2d4", terminalAfter: false, matedAfter: false },
      12, TH, eng);
    assert.strictEqual(a.cpl, 80);
    assert.strictEqual(a.level, 3);
    assert.strictEqual(a.best, "e2e4");
  });

  await atest("analyzeMove: matching engine best → cpl 0 regardless of evals", async () => {
    const eng = fakeEngine({ fenA: 50, fenB: 200 }, { fenA: "d2d4" });
    const a = await CMT.analyzeMove(
      { fenBefore: "fenA", fenAfter: "fenB", uci: "d2d4", terminalAfter: false, matedAfter: false },
      12, TH, eng);
    assert.strictEqual(a.cpl, 0);
    assert.strictEqual(a.level, 0);
  });

  await atest("analyzeMove: delivering mate is Best", async () => {
    const eng = fakeEngine({ fenA: 900 }, { fenA: "h5f7" });
    const a = await CMT.analyzeMove(
      { fenBefore: "fenA", fenAfter: "x", uci: "d8h4", terminalAfter: true, matedAfter: true },
      12, TH, eng);
    assert.strictEqual(a.cpl, 0);
  });

  await atest("runAnalysis aggregates identical positions across games", async () => {
    // Two identical games: user (white) plays e4, d4, Nc3 twice.
    const eng = fakeEngine({}, {});
    const results = await CMT.runAnalysis([GAME, JSON.parse(JSON.stringify(GAME))], SETTINGS, { engine: eng });
    // 3 unique positions (start, after b6, after Bb7), each seen twice.
    assert.strictEqual(results.length, 3);
    for (const r of results) {
      assert.strictEqual(r.total, 2);
      assert.strictEqual(r.plays.length, 1);
      assert.strictEqual(r.plays[0].count, 2);
    }
  });

  await atest("runAnalysis: control.stop still yields aggregated (ungraded) positions", async () => {
    const eng = fakeEngine({}, {});
    const control = { stop: true }; // stop before any grading
    const results = await CMT.runAnalysis([GAME], SETTINGS, { engine: eng, control });
    assert.ok(results.length > 0); // aggregation is engine-free and instant
    assert.ok(results.every((r) => !r.graded && r.best == null));
    assert.ok(results.every((r) => r.plays.every((p) => p.level == null)));
  });

  await atest("aggregate → gradePositions: counts and win-% inputs first, grades later", async () => {
    const results = CMT.aggregatePositions([GAME], SETTINGS);
    assert.ok(results.length > 0);
    const r = results[0];
    assert.strictEqual(r.graded, false);
    assert.ok(r.plays[0].gameIds.length === 1 && r.plays[0].gameIds[0] === "g0");
    await CMT.gradePositions(results, SETTINGS, { engine: fakeEngine({}, {}) });
    assert.ok(results.every((x) => x.graded && x.best != null));
    assert.ok(results.every((x) => x.plays.every((p) => p.level != null)));
  });

  test("buildGameIndex + buildPosIndex + scoreStats", () => {
    const gi = CMT.buildGameIndex([GAME], "tester");
    assert.strictEqual(gi.length, 1);
    assert.strictEqual(gi[0].id, "g0");
    assert.strictEqual(gi[0].userColor, "w");
    assert.strictEqual(gi[0].score, 0); // Result 0-1, user was White
    assert.deepStrictEqual(gi[0].sans.slice(0, 2), ["e4", "b6"]);
    const idx = CMT.buildPosIndex(gi, 60);
    const startKey = CMT.posKey("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    assert.deepStrictEqual(idx.get(startKey).gameIds, ["g0"]);
    assert.deepStrictEqual(idx.get(startKey).byMove.get("e2e4"), ["g0"]);
    const byId = new Map(gi.map((g) => [g.id, g]));
    const st = CMT.scoreStats(["g0"], byId);
    assert.deepStrictEqual(st, { n: 1, pct: 0, w: 0, d: 0, l: 1 });
  });

  console.log("flagging & exemptions");

  function makePosition(over) {
    return Object.assign({
      key: "K", fen: "F w KQkq -", moveNo: 5, color: "w", opening: "Test",
      best: "e2e4", bestEval: 30, phase: "Opening", accept: 1,
      total: 4, badCount: 0, badShare: 0, avgCpl: 120,
      plays: [{ uci: "g1f3", san: "Nf3", count: 4, cplSum: 480, level: 4 }],
      flagged: false, url: "",
    }, over);
  }

  test("recomputeFlags: bad move over threshold gets flagged", () => {
    const list = [makePosition({})];
    CMT.recomputeFlags(list, SETTINGS, true, new Set());
    assert.strictEqual(list[0].badCount, 4);
    assert.strictEqual(list[0].flagged, true);
  });

  test("recomputeFlags: phase-dependent acceptance", () => {
    // Same level-2 (Good) play: bad in the opening (accept Excellent),
    // fine in the middlegame (accept Good).
    const opening = makePosition({ moveNo: 5, plays: [{ uci: "a", san: "a3", count: 2, cplSum: 80, level: 2 }], total: 2 });
    const middle = makePosition({ moveNo: 15, plays: [{ uci: "a", san: "a3", count: 2, cplSum: 80, level: 2 }], total: 2 });
    const list = [opening, middle];
    CMT.recomputeFlags(list, SETTINGS, true, new Set());
    assert.strictEqual(opening.flagged, true);
    assert.strictEqual(middle.flagged, false);
  });

  test("recomputeFlags: book exemption honors the toggle", () => {
    const list = [makePosition({ plays: [{ uci: "g1f3", san: "Nf3", count: 4, cplSum: 480, level: 4, book: true }] })];
    CMT.recomputeFlags(list, SETTINGS, true, new Set());
    assert.strictEqual(list[0].flagged, false, "book move should not flag when ignoring book");
    CMT.recomputeFlags(list, SETTINGS, false, new Set());
    assert.strictEqual(list[0].flagged, true, "book exemption off → flags again");
  });

  test("recomputeFlags: custom set always exempts", () => {
    const list = [makePosition({})];
    CMT.recomputeFlags(list, SETTINGS, false, new Set(["K|g1f3"]));
    assert.strictEqual(list[0].flagged, false);
  });

  test("recomputeFlags: minOcc and flagShare respected", () => {
    const list = [makePosition({})];
    CMT.recomputeFlags(list, Object.assign({}, SETTINGS, { minOcc: 5 }), true, new Set());
    assert.strictEqual(list[0].flagged, false, "seen 4 < minOcc 5");
    const mixed = makePosition({
      total: 4,
      plays: [
        { uci: "a", san: "a3", count: 1, cplSum: 300, level: 4 },
        { uci: "b", san: "b3", count: 3, cplSum: 30, level: 0 },
      ],
    });
    CMT.recomputeFlags([mixed], SETTINGS, true, new Set());
    assert.strictEqual(mixed.badShare, 0.25);
    assert.strictEqual(mixed.flagged, false, "25% bad < 50% flagShare");
  });

  test("sortResults modes", () => {
    const a = makePosition({ key: "a", total: 5, badShare: 0.2, avgCpl: 10, moveNo: 9 });
    const b = makePosition({ key: "b", total: 2, badShare: 0.9, avgCpl: 90, moveNo: 3 });
    assert.strictEqual(CMT.sortResults([a, b], "occ")[0].key, "a");
    assert.strictEqual(CMT.sortResults([a, b], "badshare")[0].key, "b");
    assert.strictEqual(CMT.sortResults([a, b], "cpl")[0].key, "b");
    assert.strictEqual(CMT.sortResults([a, b], "move")[0].key, "b");
  });

  console.log("drill helpers");

  test("filterDrillPositions: thresholds are inclusive and keys are deduplicated", () => {
    const boundary = makePosition({ key: "boundary", total: 3, badCount: 1, badShare: 0.5, moveNo: 4 });
    const another = makePosition({ key: "another", total: 4, badCount: 2, badShare: 0.75, moveNo: 8 });
    const belowOccurrences = makePosition({ key: "few", total: 2, badCount: 2, badShare: 1, moveNo: 8 });
    const belowShare = makePosition({ key: "low", total: 8, badCount: 3, badShare: 0.49, moveNo: 8 });
    const duplicate = makePosition({ key: "boundary", total: 9, badCount: 9, badShare: 1, moveNo: 9 });
    const input = [boundary, belowOccurrences, belowShare, another, duplicate];
    const before = JSON.parse(JSON.stringify(input));

    const out = CMT.filterDrillPositions(input, {
      minOccurrences: 3,
      minMistakeShare: 0.5,
      skipFirst: 0,
    });

    assert.deepStrictEqual(out.map((p) => p.key), ["boundary", "another"]);
    assert.strictEqual(out[0], boundary, "filter preserves the original position object");
    assert.deepStrictEqual(input, before, "filter must not reorder or mutate its input or positions");
  });

  test("filterDrillPositions: a positive badCount is always required", () => {
    const noBad = makePosition({ key: "none", total: 5, badCount: 0, badShare: 0.8, moveNo: 5 });
    const someBad = makePosition({ key: "some", total: 5, badCount: 1, badShare: 0, moveNo: 5 });
    const out = CMT.filterDrillPositions([noBad, someBad], {
      minOccurrences: 1,
      minMistakeShare: 0,
    });
    assert.deepStrictEqual(out.map((p) => p.key), ["some"]);
  });

  test("filterDrillPositions: skipFirst excludes positions through the boundary", () => {
    const atBoundary = makePosition({ key: "at", total: 2, badCount: 1, badShare: 0.5, moveNo: 3 });
    const afterBoundary = makePosition({ key: "after", total: 2, badCount: 1, badShare: 0.5, moveNo: 4 });
    const out = CMT.filterDrillPositions([atBoundary, afterBoundary], { skipFirst: 3 });
    assert.deepStrictEqual(out.map((p) => p.key), ["after"]);
  });

  test("filterDrillPositions: normalizes options and skips malformed positions", () => {
    const numericStrings = makePosition({
      key: "strings", total: "3", badCount: "1", badShare: "0.5", moveNo: "4",
    });
    const malformed = [
      null,
      makePosition({ key: "", total: 3, badCount: 1, badShare: 0.5, moveNo: 4 }),
      makePosition({ key: "bad-total", total: "many", badCount: 1, badShare: 0.5, moveNo: 4 }),
      makePosition({ key: "bad-count", total: 3, badCount: "some", badShare: 0.5, moveNo: 4 }),
      makePosition({ key: "bad-share", total: 3, badCount: 1, badShare: "often", moveNo: 4 }),
      makePosition({ key: "bad-move", total: 3, badCount: 1, badShare: 0.5, moveNo: "late" }),
    ];

    assert.deepStrictEqual(
      CMT.filterDrillPositions([numericStrings, ...malformed], {
        minOccurrences: "2.1",
        minMistakeShare: "0.5",
        skipFirst: "3.9",
      }).map((p) => p.key),
      ["strings"],
      "numeric strings normalize; count rounds up and skipped moves round down"
    );
    assert.deepStrictEqual(
      CMT.filterDrillPositions([numericStrings], {
        minOccurrences: -10,
        minMistakeShare: -4,
        skipFirst: -2,
      }).map((p) => p.key),
      ["strings"],
      "negative options clamp to their minimums"
    );
    assert.deepStrictEqual(
      CMT.filterDrillPositions([numericStrings], {
        minOccurrences: "invalid",
        minMistakeShare: NaN,
        skipFirst: Infinity,
      }).map((p) => p.key),
      ["strings"],
      "non-finite options fall back to defaults"
    );
    assert.deepStrictEqual(CMT.filterDrillPositions(null, null), []);
  });

  test("shuffleCopy: empty and single-item inputs return new arrays without RNG calls", () => {
    let calls = 0;
    const rng = () => { calls++; return 0.5; };
    const empty = [];
    const one = [{ key: "only" }];
    const shuffledEmpty = CMT.shuffleCopy(empty, rng);
    const shuffledOne = CMT.shuffleCopy(one, rng);
    assert.deepStrictEqual(shuffledEmpty, []);
    assert.notStrictEqual(shuffledEmpty, empty);
    assert.deepStrictEqual(shuffledOne, one);
    assert.notStrictEqual(shuffledOne, one);
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(CMT.shuffleCopy(null, rng), []);
  });

  test("shuffleCopy: deterministic Fisher-Yates permutation does not mutate input", () => {
    const items = Object.freeze(["a", "b", "c", "d"]);
    const sequence = () => {
      const samples = [0.1, 0.8, 0.3];
      let i = 0;
      return () => samples[i++];
    };
    const first = CMT.shuffleCopy(items, sequence());
    const second = CMT.shuffleCopy(items, sequence());
    assert.deepStrictEqual(first, ["b", "d", "c", "a"]);
    assert.deepStrictEqual(second, first, "the same RNG sequence produces the same order");
    assert.deepStrictEqual(items, ["a", "b", "c", "d"], "source order stays unchanged");
    assert.deepStrictEqual(first.slice().sort(), items.slice().sort(), "output is a complete permutation");
    assert.notStrictEqual(first, items);
  });

  console.log("custom lines");

  test("parseLineToPairs: with and without move numbers, validates legality", () => {
    const p1 = CMT.parseLineToPairs("1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8");
    const p2 = CMT.parseLineToPairs("e4 d5 exd5 Qxd5 Nc3 Qd8");
    assert.strictEqual(p1.length, 6);
    assert.deepStrictEqual(p1.map((x) => x.san), p2.map((x) => x.san));
    assert.strictEqual(p1[5].moveNo, 3);
    assert.ok(p1[5].fen, "pairs carry fen for key re-derivation");
    assert.throws(() => CMT.parseLineToPairs("1. e4 e4"), /illegal/);
    assert.throws(() => CMT.parseLineToPairs("   "), /no moves/);
  });

  test("addCustomLine / toggleManualIgnore / removeCustomGroup maintain the set", () => {
    CMT.customBook.groups = [];
    CMT.rebuildCustomSet();
    const pairs = CMT.addCustomLine("1. e4 d5");
    assert.strictEqual(CMT.customBook.set.size, 2);
    const pos = { key: pairs[0].key, fen: pairs[0].fen, moveNo: 1 };
    assert.ok(CMT.customBook.set.has(pos.key + "|e2e4"));
    // manual toggle on a different move
    CMT.toggleManualIgnore(pos, "d2d4", "d4");
    assert.ok(CMT.customBook.set.has(pos.key + "|d2d4"));
    CMT.toggleManualIgnore(pos, "d2d4", "d4"); // toggle off
    assert.ok(!CMT.customBook.set.has(pos.key + "|d2d4"));
    CMT.removeCustomGroup(CMT.customBook.groups[0]);
    assert.strictEqual(CMT.customBook.set.size, 0);
  });

  console.log("book & import");

  await atest("bookMovesFor: masters path and lichess fallback", async () => {
    const masters = { white: 500, draws: 300, black: 200, moves: [
      { uci: "d2d4", san: "d4", white: 400, draws: 250, black: 150 }, // 80%
      { uci: "h2h4", san: "h4", white: 5, draws: 0, black: 0 },       // 0.5% → not book
    ]};
    const fetchImpl = async (url) => ({ ok: true, json: async () => masters });
    const r = await CMT.bookMovesFor("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", fetchImpl);
    assert.deepStrictEqual(r.ucis, ["d2d4"]);
    // masters thin → falls back to lichess db
    const thin = { white: 5, draws: 0, black: 0, moves: [] };
    const lichess = { white: 4000, draws: 1000, black: 3000, moves: [
      { uci: "b2b3", san: "b3", white: 300, draws: 60, black: 200 }, // 7% → book
    ]};
    let calls = 0;
    const fetch2 = async (url) => ({ ok: true, json: async () => (++calls === 1 ? thin : lichess) });
    const r2 = await CMT.bookMovesFor("some/other/fen w KQkq - 0 1", fetch2);
    assert.deepStrictEqual(r2.ucis, ["b2b3"]);
    assert.strictEqual(calls, 2);
  });

  await atest("bookMovesFor: fetch failure → unknown, not cached as empty", async () => {
    const fetchImpl = async () => { throw new Error("network down"); };
    const r = await CMT.bookMovesFor("z w KQkq - 0 1", fetchImpl);
    assert.strictEqual(r.ucis, null);
  });

  await atest("annotateBook marks plays and respects bookMax", async () => {
    const results = [
      makePosition({ moveNo: 3, fen: "f1 w KQkq - 0 1", plays: [{ uci: "d2d4", san: "d4", count: 1, cplSum: 0, level: 2 }] }),
      makePosition({ moveNo: 30, fen: "f2 w KQkq - 0 1", plays: [{ uci: "d2d4", san: "d4", count: 1, cplSum: 0, level: 2 }] }),
    ];
    const masters = { white: 500, draws: 300, black: 200, moves: [{ uci: "d2d4", white: 400, draws: 250, black: 150 }] };
    const fetchImpl = async () => ({ ok: true, json: async () => masters });
    await CMT.annotateBook(results, SETTINGS, { fetchImpl });
    assert.strictEqual(results[0].plays[0].book, true);
    assert.strictEqual(results[0].bookKnown, true);
    assert.strictEqual(results[1].plays[0].book, undefined, "beyond bookMax → untouched");
  });

  await atest("applyImport passes themes through and reports it", async () => {
    const data = {
      results: [],
      themes: { prefs: { useSystem: true, lightTheme: "blush", darkTheme: "midnight" }, custom: [] },
    };
    const { summary } = await CMT.applyImport(data, null);
    assert.strictEqual(summary.themes, true);
    const noThemes = await CMT.applyImport({ results: [] }, null);
    assert.strictEqual(noThemes.summary.themes, undefined);
  });

  test("normalizeResults re-derives keys and drops malformed rows", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    const rows = [
      { fen, key: "stale-old-key", plays: [], total: 1 },
      { key: "no-fen", plays: [] },
      null,
    ];
    const out = CMT.normalizeResults(rows);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].key, CMT.posKey(fen));
  });

  console.log("fetch");

  await atest("fetchGames: window filter, variant skip, month early-stop", async () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 86400;
    const responses = {
      archives: { archives: ["m1", "m2", "m3"] }, // m3 newest after reverse: m3, m2, m1
      m3: { games: [
        { pgn: "x", end_time: now - 2 * day, rules: "chess" },
        { pgn: "x", end_time: now - 1 * day, rules: "bughouse" }, // variant → skipped
        { pgn: "x", end_time: now - 1 * day, rules: "chess" },
      ]},
      m2: { games: [{ pgn: "x", end_time: now - 200 * day, rules: "chess" }] }, // all old
      m1: { games: [{ pgn: "x", end_time: now - 400 * day, rules: "chess" }] }, // must never be fetched
    };
    const fetched = [];
    const fetchImpl = async (url) => {
      const k = url.includes("archives") ? "archives" : url;
      fetched.push(k);
      return { ok: true, json: async () => responses[k] };
    };
    const games = await CMT.fetchGames("someone", 90, Infinity, null, fetchImpl);
    assert.strictEqual(games.length, 2);
    assert.ok(fetched.includes("m2"), "m2 checked");
    assert.ok(!fetched.includes("m1"), "older month skipped after early-stop");
  });

  await atest("fetchGames respects maxGames", async () => {
    const now = Math.floor(Date.now() / 1000);
    const g = { pgn: "x", end_time: now - 100, rules: "chess" };
    const fetchImpl = async (url) => ({
      ok: true,
      json: async () => url.includes("archives") ? { archives: ["m"] } : { games: [g, g, g, g, g] },
    });
    const games = await CMT.fetchGames("someone", 90, 2, null, fetchImpl);
    assert.strictEqual(games.length, 2);
  });

  console.log("utils");

  test("uciToSan / fmtEval / escapeHtml / fenToGrid", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    assert.strictEqual(CMT.uciToSan(start, "g1f3"), "Nf3");
    assert.strictEqual(CMT.uciToSan(start, "bogus"), "");
    assert.strictEqual(CMT.fmtEval(130), "+1.3");
    assert.strictEqual(CMT.fmtEval(-45), "-0.5");
    assert.strictEqual(CMT.escapeHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
    const grid = CMT.fenToGrid(start);
    assert.strictEqual(grid[0][4], "k");
    assert.strictEqual(grid[7][4], "K");
    assert.strictEqual(grid[4][4], null);
  });

  console.log("repertoire");

  // Tiny two-course fixture. "wcourse": as White play 1.d4; against 1...d5
  // play 2.Bf4, against 1...Nf6 play 2.Bg5. "wcourse2" overlaps on 1.d4 d5
  // (multi-course positions) but then plays 2.c4.
  function fenAfter(sans) {
    const c = new (require("chess.js").Chess)();
    for (const s of sans) c.move(s, { sloppy: true });
    return c.fen();
  }
  function mkCourse(id, color, lines) {
    // lines: array of SAN arrays; every position→move along each line.
    const positions = {};
    for (const line of lines) {
      const c = new (require("chess.js").Chess)();
      for (const san of line) {
        const key = CMT.posKey(c.fen());
        const mv = c.move(san, { sloppy: true });
        const node = positions[key] || (positions[key] = { moves: [], studies: [] });
        const uci = mv.from + mv.to + (mv.promotion || "");
        if (!node.moves.some((m) => m.uci === uci)) node.moves.push({ san: mv.san, uci });
      }
      positions[CMT.posKey(c.fen())] = positions[CMT.posKey(c.fen())] || { moves: [], studies: [] };
    }
    return { id, name: id, shortName: id, color, chapters: [], studies: {}, positions };
  }
  const WCOURSE = mkCourse("wcourse", "w", [
    ["d4", "d5", "Bf4", "Nf6", "e3"],
    ["d4", "Nf6", "Bg5", "e6", "e4"],
  ]);
  const WCOURSE2 = mkCourse("wcourse2", "w", [["d4", "d5", "c4"]]);
  const REP = { w: CMT.buildRepertoire([WCOURSE, WCOURSE2], "w"), b: CMT.buildRepertoire([WCOURSE, WCOURSE2], "b") };

  function mkGame(sans, opts) {
    opts = opts || {};
    const moves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
    return {
      pgn: `[Event "Live Chess"]\n[White "${opts.white || "tester"}"]\n[Black "${opts.black || "opp"}"]\n\n${moves} *`,
      rules: "chess", url: "https://example.com/g1",
      white: { username: opts.white || "tester" }, black: { username: opts.black || "opp" },
    };
  }

  test("classifyGame: I deviate first", () => {
    const c = CMT.classifyGame(mkGame(["d4", "d5", "Nf3"]), "tester", REP, {});
    assert.strictEqual(c.type, "user-dev");
    assert.strictEqual(c.moveNo, 2);
    assert.strictEqual(c.played.san, "Nf3");
    const sans = c.expected.map((e) => e.san).sort();
    assert.deepStrictEqual(sans, ["Bf4", "c4"]); // union of both courses
    assert.deepStrictEqual(c.courseIds.sort(), ["wcourse", "wcourse2"]); // multi-course position
    assert.strictEqual(c.passThroughs.length, 1); // 1.d4 was in book
  });

  test("classifyGame: opponent deviates first → window of my moves", () => {
    const c = CMT.classifyGame(mkGame(["d4", "e5", "dxe5", "Nc6", "Nf3", "Qe7", "Bf4"]), "tester", REP, { windowSize: 2 });
    assert.strictEqual(c.type, "opp-dev");
    assert.strictEqual(c.theirMove.san, "e5");
    assert.strictEqual(c.window.length, 2); // dxe5, Nf3 — my next two moves only
    assert.deepStrictEqual(c.window.map((m) => m.san), ["dxe5", "Nf3"]);
    assert.strictEqual(CMT.posKey(c.fen), c.posKey); // keyed on the position I face
  });

  test("classifyGame: window truncated by game end", () => {
    const c = CMT.classifyGame(mkGame(["d4", "e5", "dxe5"]), "tester", REP, { windowSize: 5 });
    assert.strictEqual(c.type, "opp-dev");
    assert.strictEqual(c.window.length, 1);
  });

  test("classifyGame: book simply ends → book-end, not a deviation", () => {
    // Full mainline then both sides continue: position after 5.e3 has no course moves.
    const c = CMT.classifyGame(mkGame(["d4", "d5", "Bf4", "Nf6", "e3", "e6", "Nf3"]), "tester", REP, {});
    assert.strictEqual(c.type, "book-end");
  });

  test("classifyGame: wrong color / unknown player → unmatched", () => {
    const asBlack = CMT.classifyGame(mkGame(["e4", "e5"], { white: "opp", black: "tester" }), "tester", REP, {});
    assert.strictEqual(asBlack.type, "unmatched"); // no black courses in fixture
    const notMine = CMT.classifyGame(mkGame(["e4"], { white: "a", black: "b" }), "tester", REP, {});
    assert.strictEqual(notMine.type, "unmatched");
  });

  test("classifyGame: transposition into book still matches (posKey lookup)", () => {
    // 1.d4 Nf6 2.Bg5 e6 reached — in book regardless of path bookkeeping.
    const c = CMT.classifyGame(mkGame(["d4", "Nf6", "Bg5", "e6", "e4", "h6"]), "tester", REP, {});
    assert.strictEqual(c.type, "book-end"); // after 5.e4 course has no reply for h6? — e4 in book, h6 hits empty node
  });

  await atest("runRepertoireAnalysis aggregates both deviation kinds", async () => {
    CMT.courseManager.bundled = [WCOURSE, WCOURSE2];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    const games = [
      mkGame(["d4", "d5", "Nf3"]),               // user-dev at move 2
      mkGame(["d4", "d5", "Nf3"]),               // same again
      mkGame(["d4", "d5", "Bf4", "Nf6", "e3"]),  // clean book pass-through
      mkGame(["d4", "e5", "dxe5", "Nc6", "Nf3"]), // opp-dev, window dxe5+Nf3
      mkGame(["d4", "e5", "dxe5", "Nc6", "Nf3"]), // identical opp deviation
    ];
    const s = Object.assign({}, SETTINGS, { windowSize: 2 });
    const eng = fakeEngine({}, {});
    const rep = await CMT.runRepertoireAnalysis(games, s, { getEngine: async () => eng });
    assert.deepStrictEqual(rep.counts, { games: 5, userDev: 2, oppDev: 2, bookEnd: 1, unmatched: 0 });
    assert.strictEqual(rep.userDev.length, 1);
    const ud = rep.userDev[0];
    assert.strictEqual(ud.devCount, undefined); // finalized shape
    assert.strictEqual(ud.badCount, 2);
    assert.strictEqual(ud.total, 3); // 2 deviations + 1 correct pass-through
    assert.ok(Math.abs(ud.badShare - 2 / 3) < 1e-9);
    assert.strictEqual(ud.multiCourse, true);
    assert.strictEqual(rep.oppDev.length, 1);
    const od = rep.oppDev[0];
    assert.strictEqual(od.count, 2);
    assert.strictEqual(od.theirMove.san, "e5");
    assert.strictEqual(od.positions.length, 2); // dxe5 position + Nf3 position
    assert.strictEqual(od.positions[0].total, 2); // both games graded
    // flags: fake engine says everything is fine (cpl 0) → no window flags
    CMT.recomputeRepertoireFlags(rep, s);
    assert.strictEqual(rep.userDev[0].flagged, true);
    assert.strictEqual(rep.oppDev[0].flagged, false);
    // drill pool: only the user-dev position qualifies
    const pool = CMT.repertoireDrillPool(rep, { minOccurrences: 1, minMistakeShare: 0.5 });
    assert.strictEqual(pool.length, 1);
    assert.strictEqual(pool[0].kind, "user-dev");
    assert.deepStrictEqual(pool[0].answerUcis.sort(), ["c1f4", "c2c4"]);
  });

  await atest("runRepertoireAnalysis flags bad window moves", async () => {
    CMT.courseManager.bundled = [WCOURSE];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    const games = [mkGame(["d4", "e5", "Nh3"])]; // opp-dev; my reply Nh3 is bad
    const cpTable = {};
    cpTable[fenAfter(["d4", "e5"])] = 150;   // engine best from here wins 1.5
    cpTable[fenAfter(["d4", "e5", "Nh3"])] = 120; // after Nh3, opp is +1.2 → I lost 270cp
    const eng = fakeEngine(cpTable, {});
    const s = Object.assign({}, SETTINGS, { windowSize: 3 });
    const rep = await CMT.runRepertoireAnalysis(games, s, { getEngine: async () => eng });
    CMT.recomputeRepertoireFlags(rep, s);
    const od = rep.oppDev[0];
    assert.strictEqual(od.positions.length, 1);
    assert.ok(od.positions[0].plays[0].level >= 4); // mistake or worse
    assert.strictEqual(od.positions[0].flagged, true);
    assert.strictEqual(od.flagged, true);
    const pool = CMT.repertoireDrillPool(rep, {});
    assert.strictEqual(pool.length, 1);
    assert.strictEqual(pool[0].kind, "opp-window");
  });

  test("classifyRepertoire aggregates positions outside every line", () => {
    CMT.courseManager.bundled = [WCOURSE, WCOURSE2];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    const games = [
      mkGame(["d4", "e5", "dxe5", "Nc6", "Nf3"]),  // opp-dev: dxe5 + Nf3 positions are off-line
      mkGame(["d4", "e5", "dxe5", "Nc6", "Nf3"]),  // same again → grouped
      mkGame(["d4", "d5", "Bf4", "Nf6", "e3"]),    // clean pass-through → nothing off-line
      mkGame(["e4"], { white: "a", black: "b" }),  // unmatched → ignored entirely
    ];
    const s = Object.assign({}, SETTINGS, { windowSize: 2, offMaxMove: 20 });
    const rep = CMT.classifyRepertoire(games, s);
    assert.strictEqual(rep.offLine.length, 2); // position after 1...e5 and after 2...Nc6
    for (const p of rep.offLine) {
      assert.strictEqual(p.kind, "off-line");
      assert.strictEqual(p.total, 2);
      assert.strictEqual(p.graded, false);
      assert.strictEqual(p.plays.length, 1);
      assert.strictEqual(p.plays[0].gameIds.length, 2);
      assert.ok(p.plays[0].fenAfter); // gradable later
    }
    assert.deepStrictEqual(rep.offLine.map((p) => p.plays[0].san).sort(), ["Nf3", "dxe5"]);
    // in-tree positions (e.g. the start position, or after 1.d4 d5) never appear
    const startKey = CMT.posKey("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    assert.ok(!rep.offLine.some((p) => p.key === startKey));
    // items filter + frequency-based flagging
    CMT.recomputeRepertoireFlags(rep, s);
    assert.ok(rep.offLine.every((p) => p.flagged)); // total 2 ≥ minOcc 1, even ungraded
    assert.strictEqual(CMT.repertoireItems(rep, "offline").length, 2);
    assert.strictEqual(CMT.repertoireItems(rep, "all").length, 1); // opp-dev only; off-line is its own view
    // offMaxMove caps collection
    const short = CMT.classifyRepertoire(games, Object.assign({}, s, { offMaxMove: 2 }));
    assert.strictEqual(short.offLine.length, 1); // only the move-2 position (dxe5)
  });

  await atest("gradeRepertoire grades your deviations and off-line positions non-destructively", async () => {
    CMT.courseManager.bundled = [WCOURSE];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    // I deviate with 2.Nf3 (course: Bf4); later 3.c4 happens outside the tree.
    const games = [mkGame(["d4", "d5", "Nf3", "e6", "c4"])];
    const cpTable = {};
    cpTable[fenAfter(["d4", "d5"])] = 200;               // best from here is +2
    cpTable[fenAfter(["d4", "d5", "Nf3"])] = 50;         // after Nf3 opp is +0.5 → cpl 250
    cpTable[fenAfter(["d4", "d5", "Nf3", "e6"])] = 300;  // best from here is +3
    cpTable[fenAfter(["d4", "d5", "Nf3", "e6", "c4"])] = 0; // after c4 → cpl 300
    const best = {};
    best[fenAfter(["d4", "d5"])] = "e2e4"; // engine best ≠ course move, to prove no clobber
    const eng = fakeEngine(cpTable, best);
    const s = Object.assign({}, SETTINGS, { windowSize: 2, offMaxMove: 20 });
    const rep = await CMT.runRepertoireAnalysis(games, s, { getEngine: async () => eng });
    // user-dev: graded, informational only — course moves stay the answer
    const ud = rep.userDev[0];
    assert.strictEqual(ud.graded, true);
    assert.strictEqual(ud.best, "e2e4");
    assert.strictEqual(ud.plays[0].level, 5); // 250cp lost → blunder
    assert.deepStrictEqual(ud.answerUcis, ["c1f4"]); // still the course move
    // off-line: graded, engine best becomes the drill answer
    assert.strictEqual(rep.offLine.length, 1);
    const ol = rep.offLine[0];
    assert.strictEqual(ol.graded, true);
    assert.strictEqual(ol.plays[0].level, 5); // 300cp lost
    assert.deepStrictEqual(ol.answerUcis, ["a2a3"]); // fake engine default best
    // flags + drill pool: the off-line blunder is drillable on its own
    CMT.recomputeRepertoireFlags(rep, s);
    assert.strictEqual(ol.badCount, 1);
    const pool = CMT.repertoireDrillPool(rep, { include: "offline" });
    assert.strictEqual(pool.length, 1);
    assert.strictEqual(pool[0].kind, "off-line");
    // nothing ungraded left
    assert.strictEqual(CMT.repUngradedPositions(rep).length, 0);
  });

  test("normalizeRepResults tolerates saves that predate offLine", () => {
    const rep = CMT.normalizeRepResults({ userDev: [], oppDev: [] });
    assert.deepStrictEqual(rep.offLine, []);
  });

  test("courseFromChesslyRaw converts fens to posKeys and derives uci", () => {
    const raw = {
      course: { id: "cid", name: "Test Course", url: "" },
      courseMeta: { color: "B", shortName: "TC" },
      chapters: [{ id: "ch1", name: "Chapter 1" }],
      studies: { s1: { name: "Study 1", chapterId: "ch1" } },
      positions: {
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1": { m: ["e4"], s: ["s1"] },
        // old-style ep square that is NOT capturable → normalized to '-'
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1": { m: ["e6"], s: ["s1"] },
      },
    };
    const course = CMT.courseFromChesslyRaw(raw);
    assert.strictEqual(course.color, "b");
    const keys = Object.keys(course.positions);
    assert.ok(keys.every((k) => k.split(" ").length === 4)); // no counters
    assert.ok(keys.some((k) => k.endsWith(" b KQkq -"))); // ep normalized away
    const start = course.positions["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"];
    assert.deepStrictEqual(start.moves, [{ san: "e4", uci: "e2e4" }]);
  });

  test("courseFromLines builds a custom course from pasted lines", () => {
    const course = CMT.courseFromLines("1. e4 e6 2. d4 b6\n1. d4 e6 2. e4 b6", "Owen tries", "b");
    assert.strictEqual(course.color, "b");
    assert.strictEqual(course.custom, true);
    const startKey = CMT.posKey("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const first = course.positions[startKey].moves.map((m) => m.san).sort();
    assert.deepStrictEqual(first, ["d4", "e4"]);
    assert.throws(() => CMT.courseFromLines("1. e4", "x", "z"));
  });

  test("course manager: remove/restore bundled, imported overrides", () => {
    CMT.courseManager.bundled = [WCOURSE];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    assert.strictEqual(CMT.activeCourses().length, 1);
    CMT.removeCourse("wcourse");
    assert.strictEqual(CMT.activeCourses().length, 0);
    CMT.restoreRemovedCourses();
    assert.strictEqual(CMT.activeCourses().length, 1);
    CMT.importCourse(Object.assign({}, WCOURSE, { name: "override" }));
    const active = CMT.activeCourses();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].name, "override");
  });

  await atest("user-dev deviations marked intentional stop counting", async () => {
    CMT.courseManager.bundled = [WCOURSE];
    CMT.courseManager.imported = [];
    CMT.courseManager.removedIds = [];
    const rep = await CMT.runRepertoireAnalysis([mkGame(["d4", "d5", "Nf3"])], SETTINGS, {});
    CMT.recomputeRepertoireFlags(rep, SETTINGS);
    assert.strictEqual(rep.userDev[0].flagged, true);
    const key = rep.userDev[0].key;
    CMT.recomputeRepertoireFlags(rep, SETTINGS, new Set([key + "|g1f3"]));
    assert.strictEqual(rep.userDev[0].badCount, 0);
    assert.strictEqual(rep.userDev[0].flagged, false);
  });

  test("pathToPosition finds a course path to a deep position", () => {
    const rep = CMT.buildRepertoire([WCOURSE], "w");
    const c = new (require("chess.js").Chess)();
    ["d4", "Nf6", "Bg5", "e6"].forEach((s) => c.move(s, { sloppy: true }));
    const path = CMT.pathToPosition(rep, CMT.posKey(c.fen()));
    assert.deepStrictEqual(path, ["d4", "Nf6", "Bg5", "e6"]);
    assert.deepStrictEqual(CMT.pathToPosition(rep, CMT.posKey(new (require("chess.js").Chess)().fen())), []);
    assert.strictEqual(CMT.pathToPosition(rep, "no such key"), null);
  });

  test("normalizeRepResults re-derives keys and drops malformed entries", () => {
    const rep = {
      userDev: [{ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 9", plays: [] }, { plays: [] }],
      oppDev: [{ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", positions: [{ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", plays: [] }, {}] }],
    };
    const out = CMT.normalizeRepResults(rep);
    assert.strictEqual(out.userDev.length, 1);
    assert.strictEqual(out.userDev[0].key.split(" ").length, 4);
    assert.strictEqual(out.oppDev[0].positions.length, 1);
    assert.strictEqual(CMT.normalizeRepResults(null), null);
  });

  test("drillMetrics aggregates rounds into per-position history and trends", () => {
    const mk = (at, result) => ({
      at, id: "r" + at, mode: "rep",
      items: [{ key: "K1", fen: "F1", kind: "user-dev", moveNo: 4, color: "w",
                courseIds: ["c1"], courseName: "London", result, attempts: 1 }],
    });
    // 5 attempts on the same position: two early fails, then three first-tries.
    const rounds = [
      mk("2026-01-01", "revealed"), mk("2026-01-02", "skipped"),
      mk("2026-01-03", "first"), mk("2026-01-04", "first"), mk("2026-01-05", "first"),
    ];
    const m = CMT.drillMetrics(rounds);
    assert.strictEqual(m.sessions.length, 5);
    assert.strictEqual(m.sessions[0].firstTryPct, 0);
    assert.strictEqual(m.sessions[4].firstTryPct, 100);
    assert.strictEqual(m.positions.length, 1);
    const p = m.positions[0];
    assert.strictEqual(p.total, 5);
    assert.strictEqual(p.courseName, "London");
    assert.strictEqual(p.recentAvg, 1);       // last 3: first, first, first
    assert.strictEqual(p.earlierAvg, 0);      // revealed + skipped
    assert.strictEqual(p.trend, 1);           // improving
    // Scores: first=1, recovered=0.5, revealed/skipped=0.
    const m2 = CMT.drillMetrics([mk("2026-01-01", "recovered")]);
    assert.strictEqual(m2.positions[0].avgScore, 0.5);
    assert.strictEqual(m2.positions[0].trend, null); // too few attempts
  });

  test("drillMetrics is order-independent and tolerates malformed items", () => {
    const rounds = [
      { at: "2026-02-02", id: "b", items: [{ key: "K", result: "first" }] },
      { at: "2026-02-01", id: "a", items: [{ key: "K", result: "skipped" }, { result: "first" }, null] },
    ];
    const m = CMT.drillMetrics(rounds);
    assert.strictEqual(m.sessions[0].id, "a"); // sorted chronologically
    assert.deepStrictEqual(m.positions[0].attempts.map((x) => x.result), ["skipped", "first"]);
    assert.deepStrictEqual(CMT.drillMetrics(null), { sessions: [], positions: [] });
  });

  await atest("logDrillRound validates input and stamps id/time", async () => {
    assert.strictEqual(await CMT.logDrillRound(null), null);
    assert.strictEqual(await CMT.logDrillRound({ items: [] }), null);
    const rec = await CMT.logDrillRound({ mode: "rep", items: [{ key: "K", result: "first" }] });
    assert.ok(rec.id && rec.at);
    assert.strictEqual(rec.v, 1);
    assert.strictEqual(rec.items[0].key, "K");
    assert.deepStrictEqual(rec.items[0].courseIds, []);
    // Node has no IndexedDB, so the log reads back empty — but never throws.
    assert.deepStrictEqual(await CMT.loadDrillLog(), []);
  });

  await atest("export/import round-trip carries favorites and the drill log", async () => {
    const payload = await CMT.buildExport("tester", SETTINGS, []);
    assert.ok("favorites" in payload && "drillLog" in payload && "drillHistory" in payload);
    // applyImport accepts (and doesn't choke on) the new fields.
    const out = await CMT.applyImport({
      results: [],
      favorites: ["K1", "K2"],
      drillLog: [{ id: "r1", at: "2026-01-01", items: [{ key: "K1", result: "first" }] }, { bad: true }],
    });
    assert.ok(out.summary);
    // In the browser these summary fields report what was written; in Node the
    // storage layer is a no-op but the code path must still normalize them.
    assert.strictEqual(out.summary.favorites, 2);
    assert.strictEqual(out.summary.drillLog, 1);
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
