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

  await atest("runAnalysis: control.stop yields partial results", async () => {
    const eng = fakeEngine({}, {});
    const control = { stop: true }; // stop immediately
    const results = await CMT.runAnalysis([GAME], SETTINGS, { engine: eng, control });
    assert.strictEqual(results.length, 0);
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

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
