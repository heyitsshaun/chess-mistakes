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
    async evaluate(fen, depth) {
      const ck = depth + "|" + fen;
      if (this.cache.has(ck)) return this.cache.get(ck);
      const stored = await storage.get("evals", ck);
      if (stored) { this.cache.set(ck, stored); return stored; }

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
  function extractUserMoves(game, username, maxMove) {
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
          terminalAfter: chess.game_over(),
          matedAfter: chess.in_checkmate(),
        });
      }
    }
    return out;
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

  // Analyze all user moves in `games`, aggregated by unique position.
  // deps: { engine, onStatus?, onProgress?, control? } — set control.stop=true
  // to end early with partial results.
  async function runAnalysis(games, s, deps) {
    const engine = deps.engine;
    const onStatus = deps.onStatus || noop;
    const onProgress = deps.onProgress || noop;
    const control = deps.control || {};

    const all = [];
    for (const g of games) {
      for (const m of extractUserMoves(g, s.username, s.maxMove)) all.push(m);
    }
    onStatus(games.length + " games → " + all.length + " of your moves to analyze.");

    const positions = new Map();
    let done = 0, consecutiveFailures = 0;
    for (const m of all) {
      if (control.stop) break;
      let a;
      try {
        a = await analyzeMove(m, s.depth, s.th, engine);
        consecutiveFailures = 0;
      } catch (e) {
        done++;
        if (++consecutiveFailures >= ENGINE_MAX_CONSECUTIVE_FAILURES) {
          throw new Error("Engine failing repeatedly (" + e.message + "); aborting. Partial results kept.");
        }
        continue;
      }
      const key = posKey(m.fenBefore);
      let p = positions.get(key);
      if (!p) {
        p = {
          key, fen: m.fenBefore, moveNo: m.moveNo, color: m.color,
          opening: m.opening, best: a.best, bestEval: a.bestEval,
          plays: new Map(), total: 0, cplSum: 0, url: m.url,
        };
        positions.set(key, p);
      }
      p.best = a.best; p.bestEval = a.bestEval;
      let rec = p.plays.get(m.uci);
      if (!rec) { rec = { uci: m.uci, san: m.san, count: 0, cplSum: 0, level: a.level }; p.plays.set(m.uci, rec); }
      rec.count++; rec.cplSum += a.cpl; rec.level = a.level;
      p.total++; p.cplSum += a.cpl;

      done++;
      if (done % 3 === 0 || done === all.length) {
        onProgress(done / Math.max(1, all.length));
        onStatus("Analyzing… " + done + "/" + all.length + " moves · " + positions.size + " unique positions");
        await sleep(0); // yield to keep the UI responsive
      }
    }
    await storage.flush();
    return finalize(positions, s);
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
        avgCpl: p.total ? p.cplSum / p.total : 0,
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
        if (p.level > ph.accept && !exempt) bad += p.count;
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
  function saveSession(username, results) {
    return storage.set("sessions", "last", {
      savedAt: new Date().toISOString(), username, results,
    });
  }

  async function loadSession() {
    const saved = await storage.get("sessions", "last");
    if (!saved || !saved.results || !saved.results.length) return null;
    saved.results = normalizeResults(saved.results);
    return saved;
  }

  async function buildExport(username, settings, results) {
    const evals = await storage.entries("evals");
    const themes = await storage.get("sessions", "themes"); // saved by the UI layer
    return {
      formatVersion: EXPORT_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      username, settings, results,
      evals,
      customBook: customBook.groups,
      themes: themes || null,
    };
  }

  // Apply an imported backup. Returns a summary for the UI to display.
  async function applyImport(data, engine) {
    const results = normalizeResults(data.results || data);
    const summary = { positions: results.length, evals: 0, customGroups: 0, username: data.username || "" };
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
    if (data.themes && typeof data.themes === "object") {
      await storage.set("sessions", "themes", data.themes);
      summary.themes = true; // UI layer re-reads and applies after import
    }
    await storage.set("sessions", "last", {
      savedAt: data.savedAt || new Date().toISOString(),
      username: summary.username,
      results,
    });
    return { results, summary };
  }

  async function clearCaches(engine) {
    await storage.flush();
    await storage.clear("evals");
    await storage.clear("sessions");
    await saveCustomBook(); // user's ignored lines survive a cache clear
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
    fetchGames, analyzeMove, runAnalysis, finalize, recomputeFlags, sortResults,
    filterDrillPositions, shuffleCopy, normalizeResults,
    // book
    bookMovesFor, annotateBook,
    // custom lines
    customBook, rebuildCustomSet, loadCustomBook, saveCustomBook,
    addCustomLine, removeCustomGroup, toggleManualIgnore,
    // sessions / backup
    saveSession, loadSession, buildExport, applyImport, clearCaches,
    // utils
    uciToSan, fmtEval, fenToGrid, escapeHtml, clamp, sleep,
  };
});
