/* Chess Mistake Trainer — core logic (no DOM).
 *
 * Everything the app *does* lives here: fetching games, parsing PGN, running
 * Stockfish, grading moves, aggregating positions, book/custom-line exemptions,
 * and persistence. The UI layer (app.js) only reads settings from inputs,
 * renders results, and wires events — so the UI can be overhauled freely
 * without touching (or breaking) any of this. Runs in the browser (as
 * window.CMT) and in Node (module.exports) for the test suite.
 *
 * DATA MODEL
 * ----------
 * Settings (built by the UI, passed in):
 *   { username, lookback, maxGames, maxMove, depth,
 *     th: {Best, Excellent, Good, Inaccuracy, Mistake},   // max cp loss per grade
 *     phases: {openEnd, midEnd, accOpen, accMid, accEnd}, // accs are LEVELS indices
 *     flagShare, minOcc, bookMax }
 *
 * UserMove (one move you made in one game):
 *   { fenBefore, fenAfter, uci, san, moveNo, color, opening, url,
 *     terminalAfter, matedAfter }
 *
 * Position (aggregated across games; the unit shown in the UI):
 *   { key, fen, moveNo, color, opening, best, bestEval, phase, accept,
 *     total, badCount, badShare, avgCpl, plays: Play[], flagged, url,
 *     bookKnown? }
 *
 * Play (one distinct move you've tried in a Position):
 *   { uci, san, count, cplSum, level, book? }
 *
 * CustomBook group: { id, label, pairs: [{key, fen?, uci, san, moveNo}] }
 *
 * Eval (engine cache value, side-to-move perspective):
 *   { cp, mate, best }  stored under key `${depth}|${fen}`
 *   Book cache: { ucis } stored under key `book|${posKey}`
 *
 * REPERTOIRE MODE (the default mode; the engine pipeline above is "legacy")
 * Course: { id, name, shortName, color:'w'|'b', url, custom?, chapters,
 *   studies, positions: {posKey → {moves:[{san,uci}], studies:[id]}} }
 * RepResults (from runRepertoireAnalysis):
 *   userDev[]  — positions where YOU left the course first. Position-shaped
 *     (key/fen/moveNo/color/total/badCount/badShare/plays/flagged) plus
 *     kind:'user-dev', expected:[{uci,san}], answerUcis, courseName,
 *     multiCourse. total = deviations + correct pass-throughs.
 *   oppDev[]   — groups keyed by the position you face after the OPPONENT's
 *     first off-book move. kind:'opp-dev', theirMove, expected (what the
 *     course prepared for), count (games), positions[] = your next
 *     `windowSize` moves engine-graded, each Position-shaped with
 *     kind:'opp-window' and answerUcis=[engine best].
 */
"use strict";

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CMT = factory();
})(typeof self !== "undefined" ? self : this, function () {

  // Chess constructor: window.Chess in the browser, require() in Node tests.
  let ChessCtor = typeof Chess !== "undefined" ? Chess : null;
  if (!ChessCtor && typeof require === "function") {
    try { ChessCtor = require("chess.js").Chess; } catch (e) { /* tests will fail loudly */ }
  }

  // ------------------------------ constants ------------------------------
  const LEVELS = ["Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder"];

  const ENGINE_URLS = [
    "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js",
    "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
    "https://unpkg.com/stockfish.js@10.0.2/stockfish.js",
  ];
  const ENGINE_INIT_TIMEOUT_MS = 20000;
  const ENGINE_EVAL_TIMEOUT_MS = 60000; // a stuck eval triggers engine restart
  const ENGINE_MAX_CONSECUTIVE_FAILURES = 5;

  const MATE_SCORE = 1000;   // mate normalized to ±this many cp
  const CPL_MAX = 2000;      // centipawn loss is clamped to this

  const EXPLORER_MASTERS = "https://explorer.lichess.ovh/masters";
  const EXPLORER_LICHESS = "https://explorer.lichess.ovh/lichess";
  const BOOK_MASTERS_MIN_GAMES = 100;  // masters total needed to trust masters data
  const BOOK_MASTERS_MIN_SHARE = 0.01; // move share to count as book (masters)
  const BOOK_LICHESS_MIN_GAMES = 500;
  const BOOK_LICHESS_MIN_SHARE = 0.02;
  const BOOK_FETCH_DELAY_MS = 150;     // politeness delay between explorer fetches

  const EXPORT_FORMAT_VERSION = 2;

  // ------------------------------ small utils ------------------------------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const noop = () => {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ------------------------------ grading ------------------------------
  // Grade a move from its centipawn loss. Returns an index into LEVELS.
  function classify(cpl, th) {
    if (cpl <= th.Best) return 0;
    if (cpl <= th.Excellent) return 1;
    if (cpl <= th.Good) return 2;
    if (cpl <= th.Inaccuracy) return 3;
    if (cpl <= th.Mistake) return 4;
    return 5;
  }

  function phaseOf(moveNo, ph) {
    if (moveNo <= ph.openEnd) return { name: "Opening", accept: ph.accOpen };
    if (moveNo <= ph.midEnd) return { name: "Middlegame", accept: ph.accMid };
    return { name: "Endgame", accept: ph.accEnd };
  }

  // Normalize an engine score (side-to-move perspective) into clamped cp.
  function normScore(sc) {
    if (sc.mate != null) return Math.sign(sc.mate) * MATE_SCORE;
    return clamp(sc.cp, -MATE_SCORE, MATE_SCORE);
  }

  // ------------------------------ position keys ------------------------------
  // Group identical positions across games: placement + side + castling, plus
  // the en-passant square ONLY when an ep capture is actually possible.
  // (chess.js records an ep square after every double pawn push, which would
  // otherwise split identical positions into separate groups.)
  function epCapturable(placement, turn, ep) {
    const file = ep.charCodeAt(0) - 97;          // a=0 … h=7
    const rank = turn === "b" ? 4 : 5;           // rank the capturing pawn stands on
    const row = placement.split("/")[8 - rank];
    if (!row) return false;
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) { for (let i = 0; i < +ch; i++) cells.push(null); }
      else cells.push(ch);
    }
    const pawn = turn === "b" ? "p" : "P";
    return (file > 0 && cells[file - 1] === pawn) || (file < 7 && cells[file + 1] === pawn);
  }

  function posKey(fen) {
    const p = fen.split(" ");
    let ep = p[3] || "-";
    if (ep !== "-" && !epCapturable(p[0], p[1], ep)) ep = "-";
    return p[0] + " " + p[1] + " " + p[2] + " " + ep;
  }

  // ------------------------------ persistent storage ------------------------------
  // Key-value layer over IndexedDB with a write queue that batches puts into
  // one transaction. In Node (no indexedDB) it degrades to a no-op, so pure
  // logic stays testable. To move to a backend later (e.g. SQLite), reimplement
  // this object's methods against your API — nothing else changes.
  const storage = {
    db: null,
    ready: null,
    _queue: [],
    _timer: null,

    init() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve) => {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open("chess-mistakes", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("evals")) db.createObjectStore("evals");
          if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions");
        };
        req.onsuccess = () => { this.db = req.result; resolve(this.db); };
        req.onerror = () => resolve(null); // no persistence, app still works
      });
      return this.ready;
    },
    get(store, key) {
      return this.init().then((db) => new Promise((resolve) => {
        if (!db) return resolve(undefined);
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      }));
    },
    set(store, key, val) {
      return this.init().then((db) => new Promise((resolve) => {
        if (!db) return resolve(false);
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }));
    },
    setMany(store, obj) {
      return this.init().then((db) => new Promise((resolve) => {
        if (!db) return resolve(false);
        const tx = db.transaction(store, "readwrite");
        const st = tx.objectStore(store);
        for (const k in obj) st.put(obj[k], k);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }));
    },
    clear(store) {
      return this.init().then((db) => new Promise((resolve) => {
        if (!db) return resolve(false);
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }));
    },
    entries(store) {
      return this.flush().then(() => this.init()).then((db) => new Promise((resolve) => {
        if (!db) return resolve({});
        const out = {};
        const req = db.transaction(store).objectStore(store).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else resolve(out);
        };
        req.onerror = () => resolve(out);
      }));
    },
    count(store) {
      return this.flush().then(() => this.init()).then((db) => new Promise((resolve) => {
        if (!db) return resolve(0);
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      }));
    },
    // Batched write: queued puts are flushed in a single transaction, instead
    // of one transaction per engine eval during analysis.
    queueSet(store, key, val) {
      this._queue.push([store, key, val]);
      if (this._queue.length >= 50) this.flush();
      else if (!this._timer) this._timer = setTimeout(() => this.flush(), 800);
    },
    async flush() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!this._queue.length) return;
      const byStore = {};
      for (const [st, k, v] of this._queue) (byStore[st] = byStore[st] || {})[k] = v;
      this._queue = [];
      for (const st in byStore) await this.setMany(st, byStore[st]);
    },
  };

  // ------------------------------ Stockfish engine ------------------------------
  // Web Worker wrapper. Evals are cached in memory (L1) and IndexedDB (L2).
  // A hung eval times out, the worker is restarted, and the caller sees a
  // rejection it can skip past — one bad position can't stall a whole run.
  class Engine {
    constructor() {
      this.worker = null;
      this.url = null;
      this.cache = new Map();
      this.restarting = null;
      this.evalTimeoutMs = ENGINE_EVAL_TIMEOUT_MS;
    }

    async init() {
      let lastErr;
      for (const url of ENGINE_URLS) {
        try { await this._start(url); this.url = url; return url; }
        catch (e) { lastErr = e; }
      }
      throw new Error("Could not load Stockfish from any CDN. " + (lastErr ? lastErr.message : ""));
    }

    _line(data) { return typeof data === "string" ? data : (data && data.data) || ""; }

    _start(url) {
      return new Promise((resolve, reject) => {
        let worker;
        try {
          const blob = new Blob(["importScripts(" + JSON.stringify(url) + ");"], { type: "application/javascript" });
          worker = new Worker(URL.createObjectURL(blob));
        } catch (e) { reject(e); return; }
        let ready = false;
        const to = setTimeout(() => { if (!ready) { worker.terminate(); reject(new Error("engine init timeout")); } }, ENGINE_INIT_TIMEOUT_MS);
        worker.onmessage = (ev) => {
          const line = this._line(ev.data);
          if (!ready && line.indexOf("uciok") !== -1) {
            ready = true; clearTimeout(to);
            this.worker = worker;
            worker.postMessage("setoption name Hash value 64");
            resolve();
          }
        };
        worker.onerror = (err) => { if (!ready) { clearTimeout(to); reject(err); } };
        worker.postMessage("uci");
      });
    }

    async _restart() {
      try { if (this.worker) this.worker.terminate(); } catch (e) { /* ignore */ }
      this.worker = null;
      if (this.url) { try { await this._start(this.url); } catch (e) { /* stays down */ } }
      this.restarting = null;
    }

    // Returns {cp, mate, best} from the side-to-move perspective.
    // Serialized: concurrent callers (background grading + an on-demand
    // grade + a board retry) queue up instead of corrupting the UCI stream.
    async evaluate(fen, depth) {
      const ck = depth + "|" + fen;
      if (this.cache.has(ck)) return this.cache.get(ck);
      const stored = await storage.get("evals", ck);
      if (stored) { this.cache.set(ck, stored); return stored; }
      const run = () => this._evaluateNow(fen, ck, depth);
      const p = (this._chain || Promise.resolve()).then(run, run);
      this._chain = p.catch(noop);
      return p;
    }

    async _evaluateNow(fen, ck, depth) {
      if (this.cache.has(ck)) return this.cache.get(ck);
      if (this.restarting) await this.restarting;
      const w = this.worker;
      if (!w) throw new Error("engine not running");

      return new Promise((resolve, reject) => {
        let best = null, cp = 0, mate = null;
        const to = setTimeout(() => {
          w.removeEventListener("message", onMsg);
          this.restarting = this._restart();
          reject(new Error("engine eval timeout"));
        }, this.evalTimeoutMs);
        const onMsg = (ev) => {
          const line = this._line(ev.data);
          if (line.indexOf("info") === 0 && line.indexOf(" pv ") !== -1) {
            const mCp = line.match(/score cp (-?\d+)/);
            const mMate = line.match(/score mate (-?\d+)/);
            if (mMate) { mate = +mMate[1]; cp = 0; }
            else if (mCp) { cp = +mCp[1]; mate = null; }
            const mPv = line.match(/ pv (\S+)/);
            if (mPv) best = mPv[1];
          } else if (line.indexOf("bestmove") === 0) {
            clearTimeout(to);
            const bm = line.split(/\s+/)[1];
            if (bm && bm !== "(none)") best = bm;
            w.removeEventListener("message", onMsg);
            const res = { cp, mate, best };
            this.cache.set(ck, res);
            storage.queueSet("evals", ck, res);
            resolve(res);
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage("position fen " + fen);
        w.postMessage("go depth " + depth);
      });
    }
  }

  // ------------------------------ Chess.com fetch ------------------------------
  async function fetchJson(url, fetchImpl) {
    const f = fetchImpl || fetch;
    const res = await f(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    return res.json();
  }

  // Games (with pgn) for a username within the lookback window, newest first.
  async function fetchGames(username, lookbackDays, maxGames, onStatus, fetchImpl) {
    onStatus = onStatus || noop;
    const cutoff = Date.now() / 1000 - lookbackDays * 86400;
    onStatus("Loading archive list…");
    const arch = await fetchJson(
      "https://api.chess.com/pub/player/" + encodeURIComponent(username.toLowerCase()) + "/games/archives",
      fetchImpl
    );
    const months = (arch.archives || []).slice().reverse(); // newest month first
    const games = [];
    for (const url of months) {
      onStatus("Loading games (" + games.length + " so far)…");
      let data;
      try { data = await fetchJson(url, fetchImpl); } catch (e) { continue; }
      const list = data.games || [];
      for (let i = list.length - 1; i >= 0; i--) { // newest game first
        const g = list[i];
        if (g.rules && g.rules !== "chess") continue; // skip variants
        if (!g.pgn) continue;
        if ((g.end_time || 0) < cutoff) continue;
        games.push(g);
        if (games.length >= maxGames) return games;
      }
      // If even the NEWEST game of this month is older than the cutoff, every
      // remaining (older) month is out of the window too — stop scanning.
      const newest = list.length ? (list[list.length - 1].end_time || 0) : 0;
      if (list.length && newest < cutoff) break;
    }
    return games;
  }

  // ------------------------------ PGN parsing ------------------------------
  function pgnHeader(pgn, key) {
    const m = pgn.match(new RegExp("\\[" + key + '\\s+"([^"]*)"\\]'));
    return m ? m[1] : "";
  }

  function openingName(pgn) {
    const url = pgnHeader(pgn, "ECOUrl");
    if (url) {
      const slug = url.split("/").pop() || "";
      return slug.replace(/-/g, " ").replace(/\.\.\..*$/, "").trim();
    }
    return pgnHeader(pgn, "ECO") || "";
  }

  // Extract the SAN move list from PGN, stripping comments/annotations.
  // Chess.com movetext contains clock comments like {[%clk 0:02:58.1]}, so
  // headers must be stripped line-by-line — never by searching for "]".
  function parseMoves(pgn) {
    let body = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, " "); // header tag lines
    body = body
      .replace(/\{[^}]*\}/g, " ")      // comments (incl. %clk)
      .replace(/\([^)]*\)/g, " ")      // variations
      .replace(/\$\d+/g, " ")          // NAGs
      .replace(/\b\d+\.(\.\.)?/g, " ") // move numbers
      .replace(/1-0|0-1|1\/2-1\/2|\*/g, " ");
    return body.trim().split(/\s+/).filter((t) => t && t !== ".");
  }

  // Walk a game, returning each of the user's moves with position context.
  function extractUserMoves(game, username, maxMove, gameId) {
    const uname = username.toLowerCase();
    const white = ((game.white && game.white.username) || "").toLowerCase();
    const black = ((game.black && game.black.username) || "").toLowerCase();
    const userColor = white === uname ? "w" : black === uname ? "b" : null;
    if (!userColor) return [];
    const sans = parseMoves(game.pgn);
    const chess = new ChessCtor();
    const opening = openingName(game.pgn);
    const out = [];
    for (let i = 0; i < sans.length; i++) {
      const turn = chess.turn();
      const moveNo = Math.floor(i / 2) + 1;
      const fenBefore = chess.fen();
      let mv;
      try { mv = chess.move(sans[i], { sloppy: true }); } catch (e) { break; }
      if (!mv) break;
      if (turn === userColor && moveNo <= maxMove) {
        out.push({
          fenBefore,
          fenAfter: chess.fen(),
          uci: mv.from + mv.to + (mv.promotion || ""),
          san: mv.san,
          moveNo,
          color: userColor,
          opening,
          url: game.url || "",
          gameId: gameId != null ? gameId : null,
          terminalAfter: chess.game_over(),
          matedAfter: chess.in_checkmate(),
        });
      }
    }
    return out;
  }

  // ------------------------------ game index ------------------------------
  // A lightweight record of every analyzed game, so aggregates can point back
  // to the games they came from (win %, drill-down, game viewer, explorer).
  // GameRec: { id, url, white, black, date, opening, result, userColor,
  //            score (1/0.5/0/null from the user's side), sans: [SAN] }
  function buildGameIndex(games, username) {
    const uname = (username || "").toLowerCase();
    const out = [];
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const white = (g.white && g.white.username) || "";
      const black = (g.black && g.black.username) || "";
      const userColor = white.toLowerCase() === uname ? "w" : black.toLowerCase() === uname ? "b" : null;
      const result = pgnHeader(g.pgn, "Result") || "";
      let score = null;
      if (result === "1-0") score = userColor === "w" ? 1 : 0;
      else if (result === "0-1") score = userColor === "b" ? 1 : 0;
      else if (result === "1/2-1/2") score = 0.5;
      out.push({
        id: "g" + i, url: g.url || "", white, black,
        date: pgnHeader(g.pgn, "Date") || pgnHeader(g.pgn, "UTCDate") || "",
        opening: openingName(g.pgn), result, userColor,
        score: userColor ? score : null,
        sans: parseMoves(g.pgn),
      });
    }
    return out;
  }

  // posKey → { gameIds: [], byMove: Map(uci → gameIds[]) } over every position
  // (both turns) in the indexed games, up to maxPly. Rebuilt from the game
  // index on load, never persisted.
  function buildPosIndex(gameIndex, maxPly) {
    maxPly = maxPly || 60;
    const idx = new Map();
    for (const g of gameIndex) {
      const chess = new ChessCtor();
      const seen = new Set(); // count each position once per game
      for (let i = 0; i < g.sans.length && i < maxPly; i++) {
        const key = posKey(chess.fen());
        let mv;
        try { mv = chess.move(g.sans[i], { sloppy: true }); } catch (e) { break; }
        if (!mv) break;
        const uci = mv.from + mv.to + (mv.promotion || "");
        let node = idx.get(key);
        if (!node) { node = { gameIds: [], byMove: new Map() }; idx.set(key, node); }
        if (!seen.has(key)) { node.gameIds.push(g.id); seen.add(key); }
        let list = node.byMove.get(uci);
        if (!list) { list = []; node.byMove.set(uci, list); }
        if (list[list.length - 1] !== g.id) list.push(g.id);
      }
    }
    return idx;
  }

  // Win % across a set of game ids: { n, pct, w, d, l }. pct counts draws as
  // half a win; games with unknown result are excluded.
  function scoreStats(gameIds, gameById) {
    let n = 0, sum = 0, w = 0, d = 0, l = 0;
    for (const id of gameIds || []) {
      const g = gameById.get ? gameById.get(id) : gameById[id];
      if (!g || g.score == null) continue;
      n++; sum += g.score;
      if (g.score === 1) w++; else if (g.score === 0.5) d++; else l++;
    }
    return { n, pct: n ? Math.round((sum / n) * 100) : null, w, d, l };
  }

  // Split a multi-game PGN file into API-shaped game objects.
  function gamesFromPgnText(text) {
    const chunks = text.split(/\n\n(?=\[Event )/).map((c) => c.trim()).filter(Boolean);
    return chunks.map((pgn) => {
      const site = pgnHeader(pgn, "Link") || pgnHeader(pgn, "Site") || "";
      return {
        pgn,
        rules: "chess",
        end_time: Math.floor(Date.now() / 1000),
        white: { username: pgnHeader(pgn, "White") },
        black: { username: pgnHeader(pgn, "Black") },
        url: /chess\.com/.test(site) ? site : "",
      };
    });
  }

  // ------------------------------ analysis ------------------------------
  // Grade one move: engine-best eval minus post-move eval, in cp, from the
  // mover's perspective. The post-move position has the opponent to move, so
  // its score is sign-flipped.
  async function analyzeMove(m, depth, th, engine) {
    const pre = await engine.evaluate(m.fenBefore, depth);
    const bestNorm = normScore(pre);
    let playedNorm;
    if (m.matedAfter) playedNorm = MATE_SCORE;      // mover delivered mate
    else if (m.terminalAfter) playedNorm = 0;       // stalemate / draw
    else {
      const post = await engine.evaluate(m.fenAfter, depth);
      playedNorm = -normScore(post);
    }
    let cpl = clamp(bestNorm - playedNorm, 0, CPL_MAX);
    if (m.uci === pre.best) cpl = 0;                // matched engine → Best
    return { cpl, best: pre.best, bestEval: bestNorm, level: classify(cpl, th) };
  }

  // Aggregate all user moves in `games` by unique position — NO engine.
  // This is instant, so the UI can render counts/win% immediately and let
  // grading happen in the background. Each play remembers a representative
  // fenAfter (for grading later) and the games it came from.
  function aggregatePositions(games, s) {
    const positions = new Map();
    for (let gi = 0; gi < games.length; gi++) {
      for (const m of extractUserMoves(games[gi], s.username, s.maxMove, "g" + gi)) {
        const key = posKey(m.fenBefore);
        let p = positions.get(key);
        if (!p) {
          p = {
            key, fen: m.fenBefore, moveNo: m.moveNo, color: m.color,
            opening: m.opening, best: null, bestEval: null,
            plays: new Map(), total: 0, url: m.url, graded: false,
          };
          positions.set(key, p);
        }
        let rec = p.plays.get(m.uci);
        if (!rec) {
          rec = {
            uci: m.uci, san: m.san, count: 0, cplSum: 0, level: null,
            gameIds: [], fenAfter: m.fenAfter,
            terminalAfter: m.terminalAfter, matedAfter: m.matedAfter,
          };
          p.plays.set(m.uci, rec);
        }
        rec.count++;
        if (m.gameId) rec.gameIds.push(m.gameId);
        p.total++;
      }
    }
    return finalize(positions, s);
  }

  // Engine-grade one aggregated position: one eval for the position plus one
  // per distinct move tried from it (cheaper than the old per-occurrence pass).
  async function gradePosition(r, s, engine) {
    const pre = await engine.evaluate(r.fen, s.depth);
    r.best = pre.best;
    r.bestEval = normScore(pre);
    let cplSum = 0;
    for (const p of r.plays) {
      let playedNorm;
      if (p.matedAfter) playedNorm = MATE_SCORE;
      else if (p.terminalAfter) playedNorm = 0;
      else if (p.fenAfter) {
        const post = await engine.evaluate(p.fenAfter, s.depth);
        playedNorm = -normScore(post);
      } else playedNorm = r.bestEval; // no fenAfter (old import) — treat as fine
      let cpl = clamp(r.bestEval - playedNorm, 0, CPL_MAX);
      if (p.uci === pre.best) cpl = 0;
      p.level = classify(cpl, s.th);
      p.cplSum = cpl * p.count;
      cplSum += p.cplSum;
    }
    r.avgCpl = r.total ? cplSum / r.total : 0;
    r.graded = true;
  }

  // Grade a list of positions in order, skipping already-graded ones.
  // deps: { engine, onStatus?, onProgress?, onPosition?, control? }
  async function gradePositions(list, s, deps) {
    const onStatus = deps.onStatus || noop;
    const onProgress = deps.onProgress || noop;
    const onPosition = deps.onPosition || noop;
    const control = deps.control || {};
    const todo = list.filter((r) => !r.graded);
    let done = 0, failures = 0;
    for (const r of todo) {
      if (control.stop) break;
      try {
        await gradePosition(r, s, deps.engine);
        failures = 0;
      } catch (e) {
        done++;
        if (++failures >= ENGINE_MAX_CONSECUTIVE_FAILURES) {
          throw new Error("Engine failing repeatedly (" + e.message + "); aborting. Partial results kept.");
        }
        continue;
      }
      done++;
      onPosition(r);
      if (done % 2 === 0 || done === todo.length) {
        onProgress(done / Math.max(1, todo.length));
        onStatus("Grading positions… " + done + "/" + todo.length);
        await sleep(0);
      }
    }
    await storage.flush();
  }

  // Back-compat one-shot: aggregate then grade everything.
  async function runAnalysis(games, s, deps) {
    const onStatus = deps.onStatus || noop;
    const results = aggregatePositions(games, s);
    onStatus(games.length + " games → " + results.length + " unique positions to grade.");
    await gradePositions(results, s, deps);
    return results;
  }

  // Turn the aggregation map into the Position[] the UI consumes.
  // Flag fields are filled by recomputeFlags (called on every render).
  function finalize(positions, s) {
    const arr = [];
    for (const p of positions.values()) {
      const ph = phaseOf(p.moveNo, s.phases);
      arr.push({
        key: p.key, fen: p.fen, moveNo: p.moveNo, color: p.color, opening: p.opening,
        best: p.best, bestEval: p.bestEval, phase: ph.name, accept: ph.accept,
        total: p.total, badCount: 0, badShare: 0,
        avgCpl: 0, graded: !!p.graded,
        plays: [...p.plays.values()].sort((a, b) => b.count - a.count),
        flagged: false, url: p.url,
      });
    }
    return arr;
  }

  // Re-derive bad/flag stats from stored per-play grades. Cheap — runs on
  // every render so settings/book/custom-line changes apply instantly.
  function recomputeFlags(list, s, ignoreBook, customSet) {
    customSet = customSet || new Set();
    for (const r of list) {
      const ph = phaseOf(r.moveNo, s.phases);
      r.accept = ph.accept;
      r.phase = ph.name;
      let bad = 0;
      for (const p of r.plays) {
        const exempt = (ignoreBook && p.book) || customSet.has(r.key + "|" + p.uci);
        if (p.level != null && p.level > ph.accept && !exempt) bad += p.count;
      }
      r.badCount = bad;
      r.badShare = r.total ? bad / r.total : 0;
      r.flagged = r.total >= s.minOcc && r.badShare >= s.flagShare && bad > 0;
    }
  }

  function sortResults(list, mode) {
    const by = {
      occ: (a, b) => b.total - a.total || b.badShare - a.badShare,
      badshare: (a, b) => b.badShare - a.badShare || b.total - a.total,
      cpl: (a, b) => b.avgCpl - a.avgCpl,
      move: (a, b) => a.moveNo - b.moveNo || b.total - a.total,
    }[mode] || ((a, b) => b.total - a.total);
    return list.slice().sort(by);
  }

  // Select positions eligible for a drill without changing the source results.
  // Shares use the same 0–1 representation as Position.badShare. Thresholds are
  // inclusive; skipFirst hides positions through that full-move number.
  function filterDrillPositions(results, options) {
    if (!Array.isArray(results)) return [];
    options = options && typeof options === "object" ? options : {};

    const finite = (value, fallback) => {
      try {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
      } catch (e) {
        return fallback;
      }
    };
    const minOccurrences = Math.max(1, Math.ceil(finite(options.minOccurrences, 1)));
    const minMistakeShare = clamp(finite(options.minMistakeShare, 0), 0, 1);
    const skipFirst = Math.max(0, Math.floor(finite(options.skipFirst, 0)));

    const out = [];
    const seen = new Set();
    for (const position of results) {
      if (!position || typeof position !== "object") continue;
      const key = typeof position.key === "string" ? position.key : "";
      if (!key || seen.has(key)) continue;

      const total = finite(position.total, NaN);
      const badCount = finite(position.badCount, NaN);
      const badShare = finite(position.badShare, NaN);
      const moveNo = finite(position.moveNo, NaN);
      if (
        !Number.isFinite(total) || total < minOccurrences ||
        !Number.isFinite(badCount) || badCount <= 0 ||
        !Number.isFinite(badShare) || badShare < minMistakeShare ||
        !Number.isFinite(moveNo) || moveNo <= skipFirst
      ) continue;

      seen.add(key);
      out.push(position);
    }
    return out;
  }

  // Fisher–Yates on a shallow copy. An injectable RNG keeps the helper easy to
  // test and lets callers opt into a seeded drill order later.
  function shuffleCopy(items, rng = Math.random) {
    if (!Array.isArray(items)) return [];
    const out = items.slice();
    const random = typeof rng === "function" ? rng : Math.random;
    for (let i = out.length - 1; i > 0; i--) {
      let sample = Number(random());
      if (!Number.isFinite(sample)) sample = 0;
      sample = clamp(sample, 0, 1 - Number.EPSILON);
      const j = Math.floor(sample * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Re-derive keys (posKey may improve between versions) and guard shapes.
  // Run on anything loaded from storage or an import file.
  function normalizeResults(results) {
    const out = [];
    for (const r of results || []) {
      if (!r || !r.fen || !Array.isArray(r.plays)) continue;
      r.key = posKey(r.fen);
      out.push(r);
    }
    return out;
  }

  // ------------------------------ opening book ------------------------------
  // A move is "book" if it's established theory: ≥1% of master games from the
  // position, or (when masters data is thin) ≥2% of 1600–2200 lichess games.
  // Cached persistently — each position is only ever fetched once.
  async function bookMovesFor(fen, fetchImpl) {
    const key = "book|" + posKey(fen);
    const cached = await storage.get("evals", key);
    if (cached) return { ucis: cached.ucis, fromCache: true };
    const enc = encodeURIComponent(fen);
    try {
      let d = await fetchJson(EXPLORER_MASTERS + "?fen=" + enc + "&topGames=0&moves=25", fetchImpl);
      let total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
      let ucis;
      if (total >= BOOK_MASTERS_MIN_GAMES) {
        ucis = d.moves.filter((m) => (m.white + m.draws + m.black) / total >= BOOK_MASTERS_MIN_SHARE).map((m) => m.uci);
      } else {
        d = await fetchJson(EXPLORER_LICHESS + "?fen=" + enc + "&speeds=blitz,rapid&ratings=1600,1800,2000,2200&moves=25", fetchImpl);
        total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
        ucis = total >= BOOK_LICHESS_MIN_GAMES
          ? d.moves.filter((m) => (m.white + m.draws + m.black) / total >= BOOK_LICHESS_MIN_SHARE).map((m) => m.uci)
          : [];
      }
      storage.queueSet("evals", key, { ucis });
      return { ucis, fromCache: false };
    } catch (e) {
      return { ucis: null, fromCache: true }; // unknown; don't cache failures
    }
  }

  // Mark each play in opening-range positions as book / not-book.
  // deps: { onStatus?, control?, fetchImpl? }
  async function annotateBook(results, s, deps) {
    deps = deps || {};
    const onStatus = deps.onStatus || noop;
    const control = deps.control || {};
    const targets = results.filter((r) => r.moveNo <= s.bookMax);
    let i = 0;
    for (const r of targets) {
      if (control.stop) break;
      i++;
      const res = await bookMovesFor(r.fen, deps.fetchImpl);
      if (res.ucis) {
        const set = new Set(res.ucis);
        for (const p of r.plays) p.book = set.has(p.uci);
        r.bookKnown = true;
      }
      if (i % 5 === 0 || i === targets.length) onStatus("Checking opening book… " + i + "/" + targets.length);
      if (!res.fromCache) await sleep(BOOK_FETCH_DELAY_MS);
    }
    await storage.flush();
  }

  // ------------------------------ custom ignored lines ------------------------------
  // User-defined (position, move) pairs that are never flagged — a personal
  // repertoire overriding both the engine grade and the lichess book.
  const customBook = { groups: [], set: new Set() };

  function rebuildCustomSet() {
    customBook.set = new Set();
    for (const g of customBook.groups) {
      for (const p of g.pairs) {
        // Prefer re-deriving from fen (keys can improve between versions).
        customBook.set.add((p.fen ? posKey(p.fen) : p.key) + "|" + p.uci);
      }
    }
  }

  function saveCustomBook() { return storage.set("sessions", "customBook", { groups: customBook.groups }); }

  async function loadCustomBook() {
    const saved = await storage.get("sessions", "customBook");
    if (saved && saved.groups) customBook.groups = saved.groups;
    rebuildCustomSet();
  }

  // Parse a pasted SAN line into pairs, validating legality.
  function parseLineToPairs(text) {
    const sans = parseMoves(text);
    if (!sans.length) throw new Error("no moves found");
    const c = new ChessCtor();
    const pairs = [];
    for (let i = 0; i < sans.length; i++) {
      const fenBefore = c.fen();
      const mv = c.move(sans[i], { sloppy: true });
      if (!mv) throw new Error("illegal move “" + sans[i] + "” at position " + (i + 1));
      pairs.push({
        key: posKey(fenBefore), fen: fenBefore,
        uci: mv.from + mv.to + (mv.promotion || ""),
        san: mv.san, moveNo: Math.floor(i / 2) + 1,
      });
    }
    return pairs;
  }

  function addCustomLine(text) {
    const pairs = parseLineToPairs(text);
    customBook.groups.push({ id: String(Date.now()), label: pairs.map((p) => p.san).join(" "), pairs });
    rebuildCustomSet();
    saveCustomBook();
    return pairs;
  }

  function removeCustomGroup(group) {
    customBook.groups = customBook.groups.filter((x) => x !== group);
    rebuildCustomSet();
    saveCustomBook();
  }

  function toggleManualIgnore(position, uci, san) {
    const k = position.key + "|" + uci;
    let g = customBook.groups.find((x) => x.id === "manual");
    if (customBook.set.has(k)) {
      if (g) g.pairs = g.pairs.filter((p) => !((p.fen ? posKey(p.fen) : p.key) === position.key && p.uci === uci));
    } else {
      if (!g) { g = { id: "manual", label: "Manually ignored moves", pairs: [] }; customBook.groups.push(g); }
      g.pairs.push({ key: position.key, fen: position.fen, uci, san, moveNo: position.moveNo });
    }
    customBook.groups = customBook.groups.filter((x) => x.pairs.length);
    rebuildCustomSet();
    saveCustomBook();
  }

  // ------------------------------ sessions / export ------------------------------
  // extra: { rep?, mode?, gameIndex? } — repertoire results, active mode, and
  // the game index (for win % / drill-down after a reload).
  function saveSession(username, results, extra) {
    extra = extra || {};
    return storage.set("sessions", "last", {
      savedAt: new Date().toISOString(), username, results,
      rep: extra.rep || null, mode: extra.mode || null,
      gameIndex: extra.gameIndex || null,
    });
  }

  async function loadSession() {
    const saved = await storage.get("sessions", "last");
    if (!saved) return null;
    saved.results = normalizeResults(saved.results || []);
    saved.rep = normalizeRepResults(saved.rep);
    if (!saved.results.length && !saved.rep) return null;
    return saved;
  }

  async function buildExport(username, settings, results, extra) {
    extra = extra || {};
    const evals = await storage.entries("evals");
    const themes = await storage.get("sessions", "themes"); // saved by the UI layer
    const drillHistory = await storage.get("sessions", "drillHistory");
    return {
      drillHistory: drillHistory || null,
      formatVersion: EXPORT_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      username, settings, results,
      rep: extra.rep || null,
      mode: extra.mode || null,
      gameIndex: extra.gameIndex || null,
      courses: { imported: courseManager.imported, removedIds: courseManager.removedIds },
      evals,
      customBook: customBook.groups,
      themes: themes || null,
    };
  }

  // Apply an imported backup. Returns a summary for the UI to display.
  async function applyImport(data, engine) {
    const results = normalizeResults(data.results || data);
    const rep = normalizeRepResults(data.rep);
    const summary = {
      positions: results.length, evals: 0, customGroups: 0, courses: 0,
      rep: !!rep, mode: data.mode || null, username: data.username || "",
    };
    if (data.evals && typeof data.evals === "object") {
      await storage.setMany("evals", data.evals);
      if (engine) for (const k in data.evals) engine.cache.set(k, data.evals[k]);
      summary.evals = Object.keys(data.evals).length;
    }
    if (Array.isArray(data.customBook) && data.customBook.length) {
      customBook.groups = data.customBook;
      rebuildCustomSet();
      await saveCustomBook();
      summary.customGroups = data.customBook.length;
    }
    if (data.courses && typeof data.courses === "object") {
      if (Array.isArray(data.courses.imported)) courseManager.imported = data.courses.imported;
      if (Array.isArray(data.courses.removedIds)) courseManager.removedIds = data.courses.removedIds;
      await saveCourses();
      summary.courses = courseManager.imported.length;
    }
    if (data.themes && typeof data.themes === "object") {
      await storage.set("sessions", "themes", data.themes);
      summary.themes = true; // UI layer re-reads and applies after import
    }
    if (data.drillHistory && typeof data.drillHistory === "object") {
      await storage.set("sessions", "drillHistory", data.drillHistory);
      summary.drillHistory = true;
    }
    await storage.set("sessions", "last", {
      savedAt: data.savedAt || new Date().toISOString(),
      username: summary.username,
      results, rep, mode: data.mode || null,
      gameIndex: Array.isArray(data.gameIndex) ? data.gameIndex : null,
    });
    return { results, rep, gameIndex: Array.isArray(data.gameIndex) ? data.gameIndex : null, summary };
  }

  async function clearCaches(engine) {
    await storage.flush();
    await storage.clear("evals");
    await storage.clear("sessions");
    await saveCustomBook(); // user's ignored lines survive a cache clear
    await saveCourses();    // imported courses survive too
    if (engine) engine.cache.clear();
  }

  // ------------------------------ misc utils ------------------------------
  function uciToSan(fen, uci) {
    if (!uci || uci.length < 4) return "";
    try {
      const c = new ChessCtor(fen);
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      return mv ? mv.san : "";
    } catch (e) { return ""; }
  }

  function fmtEval(norm) {
    const v = norm / 100;
    return (v >= 0 ? "+" : "") + v.toFixed(1);
  }

  // FEN placement → 8x8 grid, grid[0] = rank 8. Used by board renderers.
  function fenToGrid(fen) {
    const rows = fen.split(" ")[0].split("/");
    const grid = [];
    for (const row of rows) {
      const r = [];
      for (const ch of row) {
        if (/\d/.test(ch)) { for (let i = 0; i < +ch; i++) r.push(null); }
        else r.push(ch);
      }
      grid.push(r);
    }
    return grid;
  }

  // ------------------------------ repertoire mode ------------------------------
  // Courses are opening trees (typically crawled from Chessly) mapping
  // posKey → the moves the course plays/covers from that position, for BOTH
  // sides: at your-color positions they're your repertoire moves; at
  // opponent-color positions they're the replies the course prepares you for.
  //
  // Course: { id, name, shortName?, color: 'w'|'b', url?, custom?,
  //           chapters: [{id, name}], studies: {id: {name, chapterId}},
  //           positions: { posKey: { moves: [{san, uci}], studies: [id] } } }
  //
  // courseManager merges the bundled courses-data.js (window.CMT_COURSES,
  // passed in by the UI) with user-imported ones persisted in IndexedDB.
  const courseManager = { bundled: [], imported: [], removedIds: [] };

  function setBundledCourses(list) {
    courseManager.bundled = Array.isArray(list) ? list : [];
  }

  function activeCourses() {
    const removed = new Set(courseManager.removedIds);
    const byId = new Map();
    for (const c of courseManager.bundled) if (!removed.has(c.id)) byId.set(c.id, c);
    for (const c of courseManager.imported) if (!removed.has(c.id)) byId.set(c.id, c);
    return [...byId.values()];
  }

  function saveCourses() {
    return storage.set("sessions", "courses", {
      imported: courseManager.imported, removedIds: courseManager.removedIds,
    });
  }

  async function loadCourses() {
    const saved = await storage.get("sessions", "courses");
    if (saved) {
      courseManager.imported = Array.isArray(saved.imported) ? saved.imported : [];
      courseManager.removedIds = Array.isArray(saved.removedIds) ? saved.removedIds : [];
    }
    return activeCourses();
  }

  function removeCourse(id) {
    if (courseManager.imported.some((c) => c.id === id)) {
      courseManager.imported = courseManager.imported.filter((c) => c.id !== id);
    } else if (!courseManager.removedIds.includes(id)) {
      courseManager.removedIds.push(id);
    }
    return saveCourses();
  }

  function restoreRemovedCourses() {
    courseManager.removedIds = [];
    return saveCourses();
  }

  // Convert a raw Chessly crawl ({course, courseMeta, chapters, studies,
  // positions: {fen: {m: [san], s: [studyId]}}}) into a Course. Mirrors
  // chessly-import/build_courses_bundle.py so runtime imports match the bundle.
  function courseFromChesslyRaw(data) {
    if (!data || !data.positions || !data.course) throw new Error("not a Chessly crawl file");
    const meta = data.courseMeta || {};
    let color = (meta.color || "").toLowerCase();
    if (color !== "w" && color !== "b") {
      const tags = (meta.tags || []).join(" ");
      color = /white/i.test(tags) ? "w" : /black/i.test(tags) ? "b" : null;
    }
    if (!color) throw new Error("cannot determine course color (courseMeta.color missing)");
    const positions = {};
    for (const fen in data.positions) {
      const entry = data.positions[fen];
      if (!entry || !Array.isArray(entry.m)) continue;
      let c;
      try { c = new ChessCtor(fen); } catch (e) { continue; }
      const moves = [];
      for (const san of entry.m) {
        const mv = c.move(san, { sloppy: true });
        if (!mv) continue;
        moves.push({ san: mv.san, uci: mv.from + mv.to + (mv.promotion || "") });
        c.undo();
      }
      const key = posKey(fen);
      const node = positions[key];
      if (node) { // transpositions differing only in move counters: merge
        const known = new Set(node.moves.map((m) => m.uci));
        for (const m of moves) if (!known.has(m.uci)) node.moves.push(m);
        node.studies = [...new Set([...node.studies, ...(entry.s || [])])];
      } else {
        positions[key] = { moves, studies: entry.s || [] };
      }
    }
    return {
      id: data.course.id, name: data.course.name,
      shortName: meta.shortName || data.course.name,
      color, url: data.course.url || "",
      chapters: data.chapters || [], studies: data.studies || {},
      positions,
    };
  }

  // Build a Course from pasted SAN/PGN lines (one line per row, or a
  // multi-game PGN). Every position→move along each line is included, both
  // colors — same semantics as a crawled course.
  function courseFromLines(text, name, color) {
    if (color !== "w" && color !== "b") throw new Error("course color must be 'w' or 'b'");
    const chunks = /\[Event /.test(text)
      ? gamesFromPgnText(text).map((g) => g.pgn)
      : text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
    if (!chunks.length) throw new Error("no lines found");
    const positions = {};
    for (const chunk of chunks) {
      for (const p of parseLineToPairs(chunk)) {
        const node = positions[p.key] || (positions[p.key] = { moves: [], studies: [] });
        if (!node.moves.some((m) => m.uci === p.uci)) node.moves.push({ san: p.san, uci: p.uci });
      }
    }
    return {
      id: "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name: name || "Custom lines", shortName: name || "Custom lines",
      color, custom: true, chapters: [], studies: {}, positions,
    };
  }

  function importCourse(course) {
    courseManager.imported = courseManager.imported.filter((c) => c.id !== course.id);
    courseManager.imported.push(course);
    courseManager.removedIds = courseManager.removedIds.filter((id) => id !== course.id);
    saveCourses();
    return course;
  }

  // Merge all courses of one color into a single lookup:
  //   posKey → { moves: Map(uci → {san, courseIds: Set}), courseIds: Set }
  function buildRepertoire(courses, color) {
    const map = new Map();
    for (const c of courses) {
      if (c.color !== color) continue;
      for (const key in c.positions) {
        let node = map.get(key);
        if (!node) { node = { moves: new Map(), courseIds: new Set() }; map.set(key, node); }
        node.courseIds.add(c.id);
        for (const m of c.positions[key].moves) {
          let mm = node.moves.get(m.uci);
          if (!mm) { mm = { san: m.san, courseIds: new Set() }; node.moves.set(m.uci, mm); }
          mm.courseIds.add(c.id);
        }
      }
    }
    return map;
  }

  // Walk one game against the repertoire for the user's color. Returns the
  // first departure from the course tree:
  //   {type:'user-dev'|'opp-dev'|'book-end'|'unmatched', ...}
  // plus passThroughs: user-color positions traversed while still in book
  // (used to compute "how often I get this right" denominators).
  function classifyGame(game, username, repByColor, opts) {
    opts = opts || {};
    const windowSize = Math.max(1, opts.windowSize || 5);
    const uname = (username || "").toLowerCase();
    const white = ((game.white && game.white.username) || "").toLowerCase();
    const black = ((game.black && game.black.username) || "").toLowerCase();
    const userColor = white === uname ? "w" : black === uname ? "b" : null;
    const passThroughs = [];
    if (!userColor) return { type: "unmatched", reason: "player not in game", passThroughs };
    const rep = repByColor[userColor];
    if (!rep || !rep.size) return { type: "unmatched", reason: "no courses for this color", userColor, passThroughs };

    const sans = parseMoves(game.pgn);
    const chess = new ChessCtor();
    const opening = openingName(game.pgn);
    const url = game.url || "";
    const base = { userColor, opening, url, passThroughs };

    for (let i = 0; i < sans.length; i++) {
      const fenBefore = chess.fen();
      const key = posKey(fenBefore);
      const turn = chess.turn();
      const moveNo = Math.floor(i / 2) + 1;
      const node = rep.get(key);
      if (!node || !node.moves.size) {
        return Object.assign({ type: "book-end", plies: i }, base); // prep ran out — no one deviated
      }
      let mv;
      try { mv = chess.move(sans[i], { sloppy: true }); } catch (e) { mv = null; }
      if (!mv) return Object.assign({ type: "unmatched", reason: "unparseable game" }, base);
      const uci = mv.from + mv.to + (mv.promotion || "");
      if (node.moves.has(uci)) {
        if (turn === userColor) passThroughs.push({ key, moveNo });
        continue;
      }
      const courseIds = [...node.courseIds];
      const expected = [...node.moves].map(([u, m]) => ({ uci: u, san: m.san }));
      if (turn === userColor) {
        return Object.assign({
          type: "user-dev", posKey: key, fen: fenBefore, moveNo,
          played: { uci, san: mv.san }, expected, courseIds, plies: i,
          gameId: opts.gameId || null,
        }, base);
      }
      // Opponent deviated — collect my next `windowSize` moves.
      const afterFen = chess.fen();
      const window = [];
      for (let j = i + 1; j < sans.length && window.length < windowSize; j++) {
        const wTurn = chess.turn();
        const wFen = chess.fen();
        const wMoveNo = Math.floor(j / 2) + 1;
        let wmv;
        try { wmv = chess.move(sans[j], { sloppy: true }); } catch (e) { wmv = null; }
        if (!wmv) break;
        if (wTurn === userColor) {
          window.push({
            fenBefore: wFen, fenAfter: chess.fen(),
            uci: wmv.from + wmv.to + (wmv.promotion || ""), san: wmv.san,
            moveNo: wMoveNo, color: userColor, opening, url,
            gameId: opts.gameId || null,
            terminalAfter: chess.game_over(), matedAfter: chess.in_checkmate(),
          });
        }
      }
      return Object.assign({
        type: "opp-dev", posKey: posKey(afterFen), fen: afterFen, prevFen: fenBefore, moveNo,
        theirMove: { uci, san: mv.san }, expected, courseIds, window, plies: i,
        gameId: opts.gameId || null,
      }, base);
    }
    return Object.assign({ type: "book-end", plies: sans.length }, base);
  }

  // Classify all games against the active courses and aggregate — NO engine.
  // Window positions are built ungraded (level null); gradeRepWindows fills
  // them in later (background or on demand).
  function classifyRepertoire(games, s) {
    const courses = activeCourses();
    if (!courses.length) throw new Error("No courses loaded. Add one under Settings → Repertoire courses.");
    const repByColor = { w: buildRepertoire(courses, "w"), b: buildRepertoire(courses, "b") };
    const courseName = (id) => { const c = courses.find((x) => x.id === id); return c ? (c.shortName || c.name) : id; };

    const counts = { games: games.length, userDev: 0, oppDev: 0, bookEnd: 0, unmatched: 0 };
    const passCounts = new Map();
    const classified = [];
    for (let gi = 0; gi < games.length; gi++) {
      const c = classifyGame(games[gi], s.username, repByColor, { windowSize: s.windowSize, gameId: "g" + gi });
      classified.push(c);
      counts[{ "user-dev": "userDev", "opp-dev": "oppDev", "book-end": "bookEnd", unmatched: "unmatched" }[c.type]]++;
      for (const p of c.passThroughs) passCounts.set(p.key, (passCounts.get(p.key) || 0) + 1);
    }

    // ---- aggregate: I deviated first ----
    const userDevMap = new Map();
    for (const c of classified) {
      if (c.type !== "user-dev") continue;
      let r = userDevMap.get(c.posKey);
      if (!r) {
        r = {
          kind: "user-dev", key: c.posKey, fen: c.fen, moveNo: c.moveNo, color: c.userColor,
          opening: c.opening, expected: c.expected, courseIds: c.courseIds,
          plays: new Map(), devCount: 0, url: c.url,
        };
        userDevMap.set(c.posKey, r);
      }
      let p = r.plays.get(c.played.uci);
      if (!p) { p = { uci: c.played.uci, san: c.played.san, count: 0, gameIds: [] }; r.plays.set(c.played.uci, p); }
      p.count++;
      if (c.gameId) p.gameIds.push(c.gameId);
      r.devCount++;
    }
    const userDev = [...userDevMap.values()].map((r) => {
      const ph = phaseOf(r.moveNo, s.phases);
      const total = r.devCount + (passCounts.get(r.key) || 0);
      return {
        kind: r.kind, key: r.key, fen: r.fen, moveNo: r.moveNo, color: r.color,
        opening: r.opening, phase: ph.name, accept: ph.accept,
        expected: r.expected, answerUcis: r.expected.map((e) => e.uci),
        courseIds: r.courseIds, courseName: courseName(r.courseIds[0]),
        multiCourse: r.courseIds.length > 1,
        plays: [...r.plays.values()].sort((a, b) => b.count - a.count),
        total, badCount: r.devCount, badShare: total ? r.devCount / total : 0,
        avgCpl: 0, url: r.url, flagged: false,
      };
    });

    // ---- aggregate: opponent deviated first (windows ungraded) ----
    const oppDevMap = new Map();
    for (const c of classified) {
      if (c.type !== "opp-dev") continue;
      let g = oppDevMap.get(c.posKey);
      if (!g) {
        g = {
          kind: "opp-dev", key: c.posKey, fen: c.fen, prevFen: c.prevFen, moveNo: c.moveNo,
          color: c.userColor, opening: c.opening, theirMove: c.theirMove, expected: c.expected,
          courseIds: c.courseIds, count: 0, gameIds: [], url: c.url, positions: new Map(),
        };
        oppDevMap.set(c.posKey, g);
      }
      g.count++;
      if (c.gameId) g.gameIds.push(c.gameId);
      for (const m of c.window) {
        const key = posKey(m.fenBefore);
        let p = g.positions.get(key);
        if (!p) {
          p = {
            kind: "opp-window", key, groupKey: g.key, fen: m.fenBefore, moveNo: m.moveNo,
            color: m.color, opening: m.opening, best: null, bestEval: null,
            plays: new Map(), total: 0, url: m.url, graded: false,
          };
          g.positions.set(key, p);
        }
        let rec = p.plays.get(m.uci);
        if (!rec) {
          rec = {
            uci: m.uci, san: m.san, count: 0, cplSum: 0, level: null,
            gameIds: [], fenAfter: m.fenAfter,
            terminalAfter: m.terminalAfter, matedAfter: m.matedAfter,
          };
          p.plays.set(m.uci, rec);
        }
        rec.count++;
        if (m.gameId) rec.gameIds.push(m.gameId);
        p.total++;
      }
    }

    const oppDev = [...oppDevMap.values()].map((g) => {
      const ph = phaseOf(g.moveNo, s.phases);
      const positions = [...g.positions.values()].map((p) => {
        const pph = phaseOf(p.moveNo, s.phases);
        return {
          kind: p.kind, key: p.key, groupKey: p.groupKey, fen: p.fen, moveNo: p.moveNo,
          color: p.color, opening: p.opening, best: p.best, bestEval: p.bestEval,
          phase: pph.name, accept: pph.accept,
          total: p.total, badCount: 0, badShare: 0,
          avgCpl: 0, graded: false,
          plays: [...p.plays.values()].sort((a, b) => b.count - a.count),
          flagged: false, url: p.url, answerUcis: [],
        };
      }).sort((a, b) => a.moveNo - b.moveNo);
      return {
        kind: g.kind, key: g.key, fen: g.fen, prevFen: g.prevFen, moveNo: g.moveNo,
        color: g.color, opening: g.opening, phase: ph.name, accept: ph.accept,
        theirMove: g.theirMove, expected: g.expected,
        courseIds: g.courseIds, courseName: courseName(g.courseIds[0]),
        multiCourse: g.courseIds.length > 1,
        count: g.count, total: g.count, gameIds: g.gameIds, badCount: 0, badShare: 0,
        avgCpl: 0, positions, url: g.url, flagged: false,
      };
    });

    return { userDev, oppDev, counts, savedAt: new Date().toISOString() };
  }

  function repWindowPositions(rep) {
    const out = [];
    for (const g of rep.oppDev) for (const p of g.positions) out.push(p);
    return out;
  }

  // Engine-grade every window position (the only engine use in this mode).
  // deps: { engine, onStatus?, onProgress?, onPosition?, control? }
  async function gradeRepWindows(rep, s, deps) {
    const todo = repWindowPositions(rep).filter((p) => !p.graded);
    if (!todo.length) return;
    await gradePositions(todo, s, deps);
    for (const p of todo) if (p.graded) p.answerUcis = p.best ? [p.best] : [];
  }

  // Back-compat one-shot: classify then grade all windows.
  async function runRepertoireAnalysis(games, s, deps) {
    deps = deps || {};
    const rep = classifyRepertoire(games, s);
    const c = rep.counts;
    (deps.onStatus || noop)(`${c.games} games: ${c.userDev} you deviated, ${c.oppDev} opponent deviated, ` +
      `${c.bookEnd} in-book, ${c.unmatched} unmatched.`);
    if (deps.getEngine && repWindowPositions(rep).some((p) => !p.graded)) {
      const engine = await deps.getEngine();
      await gradeRepWindows(rep, s, Object.assign({}, deps, { engine }));
    }
    return rep;
  }

  // Re-derive flags for repertoire results — cheap, runs on every render so
  // threshold changes apply instantly. customSet exempts (key|uci) pairs on
  // graded window moves, same as legacy manual-ignore.
  function recomputeRepertoireFlags(rep, s, customSet) {
    if (!rep) return;
    customSet = customSet || new Set();
    for (const r of rep.userDev) {
      // Deviations the user marked as intentional (custom-ignored) don't count.
      let bad = 0;
      for (const p of r.plays) if (!customSet.has(r.key + "|" + p.uci)) bad += p.count;
      r.badCount = bad;
      r.badShare = r.total ? bad / r.total : 0;
      r.flagged = r.total >= s.minOcc && r.badShare >= s.flagShare && r.badCount > 0;
    }
    for (const g of rep.oppDev) {
      let groupBad = 0, groupTotal = 0, groupCpl = 0;
      for (const p of g.positions) {
        const ph = phaseOf(p.moveNo, s.phases);
        p.accept = ph.accept; p.phase = ph.name;
        let bad = 0, cplSum = 0;
        for (const q of p.plays) {
          cplSum += q.cplSum || 0;
          if (q.level != null && q.level > ph.accept && !customSet.has(p.key + "|" + q.uci)) bad += q.count;
        }
        p.badCount = bad;
        p.badShare = p.total ? bad / p.total : 0;
        p.avgCpl = p.total ? cplSum / p.total : 0;
        p.flagged = p.badCount > 0;
        groupBad += bad; groupTotal += p.total; groupCpl += cplSum;
      }
      g.badCount = groupBad;
      g.badShare = groupTotal ? groupBad / groupTotal : 0;
      g.avgCpl = groupTotal ? groupCpl / groupTotal : 0;
      g.flagged = g.count >= s.minOcc && groupBad > 0;
    }
  }

  // Flatten repertoire results into one sortable card list for the UI.
  // filter: 'all' | 'user' | 'opp'
  function repertoireItems(rep, filter) {
    if (!rep) return [];
    let items = [];
    if (filter !== "opp") items = items.concat(rep.userDev);
    if (filter !== "user") items = items.concat(rep.oppDev);
    return items;
  }

  // Drill pool for repertoire mode: user-dev positions (answer = any course
  // move) plus graded window positions where you erred (answer = engine best).
  function repertoireDrillPool(rep, options) {
    if (!rep) return [];
    options = options || {};
    const include = options.include || "all"; // 'all' | 'user' | 'opp'
    let pool = [];
    if (include !== "opp") {
      pool = pool.concat(filterDrillPositions(rep.userDev, options).filter((r) => r.flagged));
    }
    if (include !== "user") {
      const minShare = clamp(Number(options.minMistakeShare) || 0, 0, 1);
      for (const g of rep.oppDev) {
        if (g.count < Math.max(1, Math.ceil(options.minOccurrences || 1))) continue;
        pool = pool.concat(g.positions.filter((p) =>
          p.flagged && p.best && p.badShare >= minShare && p.moveNo > (options.skipFirst || 0)));
      }
    }
    return pool;
  }

  // ------------------------------ line explorer ------------------------------
  // Shortest SAN path through a repertoire tree from the start position to
  // the position with `targetKey`. BFS over course moves; null if the
  // position isn't in the tree. Used to deep-link deviations into the
  // explorer.
  function pathToPosition(rep, targetKey, startFen) {
    startFen = startFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    if (posKey(startFen) === targetKey) return [];
    const visited = new Set([posKey(startFen)]);
    const queue = [{ fen: startFen, sans: [] }];
    while (queue.length) {
      const { fen, sans } = queue.shift();
      const node = rep.get(posKey(fen));
      if (!node) continue;
      for (const [, m] of node.moves) {
        const c = new ChessCtor(fen);
        let mv;
        try { mv = c.move(m.san, { sloppy: true }); } catch (e) { mv = null; }
        if (!mv) continue;
        const nf = c.fen();
        const nk = posKey(nf);
        if (visited.has(nk)) continue;
        const nextSans = sans.concat(mv.san);
        if (nk === targetKey) return nextSans;
        visited.add(nk);
        queue.push({ fen: nf, sans: nextSans });
      }
    }
    return null;
  }

  // Stats for one position while browsing course lines:
  //   courseMoves — the course tree's moves here
  //   stats       — win % over the games that reached this position
  //   played      — every move actually played here across your games (either
  //                 side, since whoever's turn it is made the move), with
  //                 in-course flag and per-move win %
  //   deviationPct— of the games where it was YOUR turn here, how often you
  //                 played something off-course
  // rep: merged course lookup from buildRepertoire (any color mix);
  // gameById: Map(id → GameRec); posIndex from buildPosIndex.
  function explorerStats(fen, rep, gameById, posIndex) {
    const key = posKey(fen);
    const turn = fen.split(" ")[1];
    const repNode = rep.get(key);
    const node = posIndex.get(key) || { gameIds: [], byMove: new Map() };
    const courseMoves = repNode
      ? [...repNode.moves].map(([uci, m]) => ({ uci, san: m.san, courseIds: [...m.courseIds] }))
      : [];
    const played = [];
    let devN = 0, devTotal = 0;
    for (const [uci, ids] of node.byMove) {
      const inCourse = !!(repNode && repNode.moves.has(uci));
      const userIds = ids.filter((id) => { const g = gameById.get(id); return g && g.userColor === turn; });
      devTotal += userIds.length;
      if (!inCourse) devN += userIds.length;
      played.push({
        uci, san: uciToSan(fen, uci) || uci, inCourse,
        gameIds: ids, userTurn: userIds.length, stats: scoreStats(ids, gameById),
      });
    }
    played.sort((a, b) => b.gameIds.length - a.gameIds.length);
    return {
      key, courseMoves, played,
      gameIds: node.gameIds,
      stats: scoreStats(node.gameIds, gameById),
      userToMove: devTotal > 0,
      deviationPct: devTotal ? Math.round((devN / devTotal) * 100) : null,
      devTotal,
    };
  }

  function normalizeRepResults(rep) {
    if (!rep || !Array.isArray(rep.userDev) || !Array.isArray(rep.oppDev)) return null;
    rep.userDev = rep.userDev.filter((r) => r && r.fen && Array.isArray(r.plays));
    for (const r of rep.userDev) r.key = posKey(r.fen);
    rep.oppDev = rep.oppDev.filter((g) => g && g.fen && Array.isArray(g.positions));
    for (const g of rep.oppDev) {
      g.key = posKey(g.fen);
      g.positions = g.positions.filter((p) => p && p.fen && Array.isArray(p.plays));
      for (const p of g.positions) { p.key = posKey(p.fen); p.groupKey = g.key; }
    }
    return rep;
  }

  // ------------------------------ public API ------------------------------
  return {
    // constants
    LEVELS, MATE_SCORE,
    // grading / keys
    classify, phaseOf, normScore, posKey, epCapturable,
    // parsing
    parseMoves, pgnHeader, openingName, extractUserMoves, gamesFromPgnText, parseLineToPairs,
    // engine + storage
    Engine, storage,
    // fetch / analysis
    fetchGames, analyzeMove, runAnalysis, aggregatePositions, gradePosition,
    gradePositions, finalize, recomputeFlags, sortResults,
    filterDrillPositions, shuffleCopy, normalizeResults,
    // game index / explorer
    buildGameIndex, buildPosIndex, scoreStats, explorerStats, pathToPosition,
    // book
    bookMovesFor, annotateBook,
    // custom lines
    customBook, rebuildCustomSet, loadCustomBook, saveCustomBook,
    addCustomLine, removeCustomGroup, toggleManualIgnore,
    // repertoire mode
    courseManager, setBundledCourses, activeCourses, loadCourses, removeCourse,
    restoreRemovedCourses, courseFromChesslyRaw, courseFromLines, importCourse,
    buildRepertoire, classifyGame, classifyRepertoire, gradeRepWindows,
    repWindowPositions, runRepertoireAnalysis, recomputeRepertoireFlags,
    repertoireItems, repertoireDrillPool, normalizeRepResults,
    // sessions / backup
    saveSession, loadSession, buildExport, applyImport, clearCaches,
    // utils
    uciToSan, fmtEval, fenToGrid, escapeHtml, clamp, sleep,
  };
});
