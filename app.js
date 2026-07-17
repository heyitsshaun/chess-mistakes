/* Chess Mistake Trainer
 * Runs entirely in the browser. Pulls games from the Chess.com public API,
 * analyzes each of your moves with Stockfish (WASM), groups by unique position,
 * and flags positions where you repeatedly play sub-optimal moves.
 */
"use strict";

// ----------------------------- small helpers -----------------------------
const $ = (id) => document.getElementById(id);
const LEVELS = ["Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder"];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read settings from the UI each run so changes take effect without reload.
function readSettings() {
  return {
    username: $("username").value.trim(),
    lookback: +$("lookback").value,
    maxGames: +$("maxGames").value || Infinity, // 0 or blank = unlimited
    maxMove: +$("maxMove").value,
    depth: clamp(+$("depth").value, 6, 20),
    th: {
      Best: +$("thBest").value, Excellent: +$("thExc").value, Good: +$("thGood").value,
      Inaccuracy: +$("thInacc").value, Mistake: +$("thMist").value,
    },
    phases: {
      openEnd: +$("phOpenEnd").value,
      midEnd: +$("phMidEnd").value,
      accOpen: +$("accOpen").value,   // index into LEVELS (max acceptable)
      accMid: +$("accMid").value,
      accEnd: +$("accEnd").value,
    },
    flagShare: clamp(+$("flagShare").value, 0, 1),
    minOcc: Math.max(1, +$("minOcc").value),
    bookMax: +$("bookMax").value,
  };
}

// Grade a move from its centipawn loss using the configurable thresholds.
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
// Normalize an engine score (side-to-move perspective) into clamped centipawns.
function normScore(sc) {
  if (sc.mate != null) return Math.sign(sc.mate) * 1000;
  return clamp(sc.cp, -1000, 1000);
}

// A position "key" ignores move counters so the same position from different
// games groups together (placement + side + castling + en passant).
function posKey(fen) { return fen.split(" ").slice(0, 4).join(" "); }

// ----------------------------- persistent storage -----------------------------
// Tiny key-value layer over IndexedDB. Two stores: "evals" (engine cache,
// keyed depth|fen) and "sessions" (last analysis results). If you later add a
// backend, reimplement get/set against it (e.g. SQLite) and nothing else changes.
const idb = {
  db: null,
  ready: null,
  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open("chess-mistakes", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("evals")) db.createObjectStore("evals");
        if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions");
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => resolve(null); // storage unavailable -> app still works, just no persistence
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
    return this.init().then((db) => new Promise((resolve) => {
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
  count(store) {
    return this.init().then((db) => new Promise((resolve) => {
      if (!db) return resolve(0);
      const req = db.transaction(store).objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    }));
  },
};

// ----------------------------- Stockfish engine -----------------------------
// Loaded as a Web Worker. We try several CDN builds so a single dead URL
// doesn't break the app. Works from file:// because the worker is a blob that
// importScripts() the real engine.
const ENGINE_URLS = [
  "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js",
  "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js",
  "https://unpkg.com/stockfish.js@10.0.2/stockfish.js",
];

class Engine {
  constructor() { this.worker = null; this.busy = false; this.cache = new Map(); }

  async init() {
    let lastErr;
    for (const url of ENGINE_URLS) {
      try { await this._start(url); return url; }
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
      const to = setTimeout(() => { if (!ready) { worker.terminate(); reject(new Error("engine timeout")); } }, 20000);
      worker.onmessage = (ev) => {
        const line = this._line(ev.data);
        if (!ready && line.indexOf("uciok") !== -1) {
          ready = true; clearTimeout(to); this.worker = worker; resolve();
        }
      };
      worker.onerror = (err) => { if (!ready) { clearTimeout(to); reject(err); } };
      worker.postMessage("uci");
    });
  }

  // Evaluate a FEN to a given depth. Returns {cp,mate,best} from the side-to-move
  // perspective. Cached in memory (L1) and IndexedDB (L2, survives reloads).
  async evaluate(fen, depth) {
    const ck = depth + "|" + fen;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const stored = await idb.get("evals", ck);
    if (stored) { this.cache.set(ck, stored); return stored; }
    return new Promise((resolve) => {
      const w = this.worker;
      let best = null, cp = 0, mate = null;
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
          const bm = line.split(/\s+/)[1];
          if (bm && bm !== "(none)") best = bm;
          w.removeEventListener("message", onMsg);
          const res = { cp, mate, best };
          this.cache.set(ck, res);
          idb.set("evals", ck, res); // fire-and-forget write-through
          resolve(res);
        }
      };
      w.addEventListener("message", onMsg);
      w.postMessage("position fen " + fen);
      w.postMessage("go depth " + depth);
    });
  }
}

// ----------------------------- Chess.com fetch -----------------------------
async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.json();
}

// Return games (with pgn) for a username within the lookback window, newest first.
async function fetchGames(username, lookbackDays, maxGames, onStatus) {
  const cutoff = Date.now() / 1000 - lookbackDays * 86400;
  onStatus("Loading archive list…");
  const arch = await fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`);
  const months = (arch.archives || []).slice().reverse(); // newest month first
  const games = [];
  for (const url of months) {
    onStatus(`Loading games (${games.length} so far)…`);
    let data;
    try { data = await fetchJson(url); } catch (e) { continue; }
    const gs = (data.games || []).slice().reverse();
    for (const g of gs) {
      if (g.rules && g.rules !== "chess") continue;      // skip variants
      if (!g.pgn) continue;
      if ((g.end_time || 0) < cutoff) continue;
      games.push(g);
      if (games.length >= maxGames) return games;
    }
    if ((data.games && data.games.length && (data.games[0].end_time || 0) < cutoff)) {
      // whole month is older than cutoff -> older months will be too
      if (games.length) break;
    }
  }
  return games;
}

// ----------------------------- PGN parsing -----------------------------
function pgnHeader(pgn, key) {
  const m = pgn.match(new RegExp('\\[' + key + '\\s+"([^"]*)"\\]'));
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

// Extract the move list (SAN) from a PGN body, stripping comments/annotations.
// Note: chess.com movetext contains clock comments like {[%clk 0:02:58.1]},
// so headers must be stripped line-by-line — not by searching for "]".
function parseMoves(pgn) {
  let body = pgn.replace(/^\s*\[[^\n]*\]\s*$/gm, " "); // header tag lines
  body = body.replace(/\{[^}]*\}/g, " ")      // comments (incl. %clk)
             .replace(/\([^)]*\)/g, " ")      // variations
             .replace(/\$\d+/g, " ")          // NAGs
             .replace(/\b\d+\.(\.\.)?/g, " ") // move numbers
             .replace(/1-0|0-1|1\/2-1\/2|\*/g, " ");
  return body.trim().split(/\s+/).filter((t) => t && t !== ".");
}

// Walk a game, extracting each of the user's moves with the position before it.
function extractUserMoves(game, username, maxMove) {
  const uname = username.toLowerCase();
  const white = (game.white && game.white.username || "").toLowerCase();
  const black = (game.black && game.black.username || "").toLowerCase();
  let userColor = white === uname ? "w" : black === uname ? "b" : null;
  if (!userColor) return [];
  const sans = parseMoves(game.pgn);
  const chess = new Chess();
  const opening = openingName(game.pgn);
  const out = [];
  for (let i = 0; i < sans.length; i++) {
    const turn = chess.turn();
    const moveNo = Math.floor(i / 2) + 1;
    const fenBefore = chess.fen();
    let mv;
    try { mv = chess.move(sans[i], { sloppy: true }); }
    catch (e) { break; }
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

// ----------------------------- Analysis -----------------------------
let engine = null;
let stopRequested = false;
let lastResults = null; // aggregated positions for export

async function analyzeMove(m, depth, th) {
  // Pre-position: best move + best eval from user's perspective.
  const pre = await engine.evaluate(m.fenBefore, depth);
  const bestNorm = normScore(pre);
  let playedNorm;
  if (m.matedAfter) playedNorm = 1000;                 // user delivered mate
  else if (m.terminalAfter) playedNorm = 0;            // stalemate/draw
  else {
    const post = await engine.evaluate(m.fenAfter, depth); // opponent to move
    playedNorm = -normScore(post);                     // flip to user's perspective
  }
  let cpl = clamp(bestNorm - playedNorm, 0, 2000);
  if (m.uci === pre.best) cpl = 0;                     // matched engine -> Best
  return { cpl, best: pre.best, bestEval: bestNorm, level: classify(cpl, th) };
}

async function runAnalysis(games, s, onStatus, onProgress) {
  // Collect all user moves first so we can show a real progress total.
  const all = [];
  for (const g of games) {
    for (const m of extractUserMoves(g, s.username, s.maxMove)) all.push(m);
  }
  onStatus(`${games.length} games → ${all.length} of your moves to analyze.`);

  const positions = new Map(); // posKey -> aggregate
  let done = 0;
  for (const m of all) {
    if (stopRequested) break;
    let a;
    try { a = await analyzeMove(m, s.depth, s.th); }
    catch (e) { done++; continue; }
    const key = posKey(m.fenBefore);
    let p = positions.get(key);
    if (!p) {
      p = {
        key, fen: m.fenBefore, moveNo: m.moveNo, color: m.color,
        opening: m.opening, best: a.best, bestEval: a.bestEval,
        plays: new Map(), total: 0, badCount: 0, cplSum: 0, url: m.url,
      };
      positions.set(key, p);
    }
    // Keep the best-move info from the deepest/most-recent eval (they're cached, so identical).
    p.best = a.best; p.bestEval = a.bestEval;
    const ph = phaseOf(p.moveNo, s.phases);
    const bad = a.level > ph.accept;
    let rec = p.plays.get(m.uci);
    if (!rec) { rec = { uci: m.uci, san: m.san, count: 0, cplSum: 0, level: a.level }; p.plays.set(m.uci, rec); }
    rec.count++; rec.cplSum += a.cpl; rec.level = a.level;
    p.total++; p.cplSum += a.cpl; if (bad) p.badCount++;

    done++;
    if (done % 3 === 0 || done === all.length) {
      onProgress(done / Math.max(1, all.length));
      onStatus(`Analyzing… ${done}/${all.length} moves · ${positions.size} unique positions`);
      await sleep(0); // yield to keep UI responsive
    }
  }
  return finalize(positions, s);
}

// Build the flagged list from aggregated positions.
function finalize(positions, s) {
  const arr = [];
  for (const p of positions.values()) {
    const ph = phaseOf(p.moveNo, s.phases);
    const badShare = p.total ? p.badCount / p.total : 0;
    const avgCpl = p.total ? p.cplSum / p.total : 0;
    const plays = [...p.plays.values()].sort((a, b) => b.count - a.count);
    const flagged = p.total >= s.minOcc && badShare >= s.flagShare && p.badCount > 0;
    arr.push({
      key: p.key, fen: p.fen, moveNo: p.moveNo, color: p.color, opening: p.opening,
      best: p.best, bestEval: p.bestEval, phase: ph.name, accept: ph.accept,
      total: p.total, badCount: p.badCount, badShare, avgCpl, plays, flagged, url: p.url,
    });
  }
  return arr;
}

// ----------------------------- opening book (Lichess explorer) -----------------------------
// A move is "book" if it's established theory: ≥1% of master games from this
// position, or (if masters data is thin) ≥2% of 1600–2200 lichess games.
// Results are cached persistently, so each position is only ever fetched once.
async function bookMovesFor(fen) {
  const key = "book|" + posKey(fen);
  const cached = await idb.get("evals", key);
  if (cached) return { ucis: cached.ucis, fromCache: true };
  const enc = encodeURIComponent(fen);
  const get = async (url) => {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  try {
    let d = await get("https://explorer.lichess.ovh/masters?fen=" + enc + "&topGames=0&moves=25");
    let total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
    let ucis;
    if (total >= 100) {
      ucis = d.moves.filter((m) => (m.white + m.draws + m.black) / total >= 0.01).map((m) => m.uci);
    } else {
      d = await get("https://explorer.lichess.ovh/lichess?fen=" + enc + "&speeds=blitz,rapid&ratings=1600,1800,2000,2200&moves=25");
      total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
      ucis = total >= 500 ? d.moves.filter((m) => (m.white + m.draws + m.black) / total >= 0.02).map((m) => m.uci) : [];
    }
    idb.set("evals", key, { ucis });
    return { ucis, fromCache: false };
  } catch (e) {
    return { ucis: null, fromCache: true }; // unknown; don't cache failures
  }
}

// Mark each recorded play (and the engine best move) as book / not-book.
async function annotateBook(results, s, onStatus) {
  const targets = results.filter((r) => r.moveNo <= s.bookMax);
  let i = 0;
  for (const r of targets) {
    if (stopRequested) break;
    i++;
    const res = await bookMovesFor(r.fen);
    if (res.ucis) {
      const set = new Set(res.ucis);
      for (const p of r.plays) p.book = set.has(p.uci);
      r.bookKnown = true;
    }
    if (i % 5 === 0 || i === targets.length) onStatus(`Checking opening book… ${i}/${targets.length}`);
    if (!res.fromCache) await sleep(150); // be polite to the explorer API
  }
}

// Re-derive bad/flag stats from stored per-play grades. Runs on every render,
// so threshold/phase/book-toggle changes apply instantly without re-analysis.
function recomputeFlags(list, s, ignoreBook) {
  for (const r of list) {
    const accept = phaseOf(r.moveNo, s.phases).accept;
    r.accept = accept;
    let bad = 0;
    for (const p of r.plays) {
      if (p.level > accept && !(ignoreBook && p.book)) bad += p.count;
    }
    r.badCount = bad;
    r.badShare = r.total ? bad / r.total : 0;
    r.flagged = r.total >= s.minOcc && r.badShare >= s.flagShare && bad > 0;
  }
}

// ----------------------------- Rendering: list -----------------------------
function sortResults(list, mode) {
  const by = {
    occ: (a, b) => b.total - a.total || b.badShare - a.badShare,
    badshare: (a, b) => b.badShare - a.badShare || b.total - a.total,
    cpl: (a, b) => b.avgCpl - a.avgCpl,
    move: (a, b) => a.moveNo - b.moveNo || b.total - a.total,
  }[mode] || ((a, b) => b.total - a.total);
  return list.slice().sort(by);
}

function renderList() {
  if (!lastResults) return;
  const showAll = $("showAll").checked;
  const mode = $("sortBy").value;
  const hideBefore = +$("hideBefore").value || 0;
  recomputeFlags(lastResults, readSettings(), $("ignoreBook").checked);
  let list = lastResults.filter((r) => (showAll || r.flagged) && r.moveNo > hideBefore);
  list = sortResults(list, mode);
  const el = $("results");
  if (!list.length) {
    el.innerHTML = `<p class="empty">${lastResults.length ? "No positions matched the flagging criteria. Try “show all”, lower the flag share, or loosen the acceptable grades." : "No positions analyzed."}</p>`;
    return;
  }
  el.innerHTML = "";
  for (const r of list) {
    const worst = r.plays[0];
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.key = r.key;
    card.innerHTML = `
      <div class="thumb">${miniBoardSVG(r.fen, r.color)}</div>
      <div>
        <div class="meta-top">
          ${r.opening ? `<span class="opening">${escapeHtml(r.opening)}</span>` : ""}
          <span class="sub">Move ${r.moveNo} · ${r.phase} · ${r.color === "w" ? "White" : "Black"}</span>
        </div>
        <div class="line">You played <b>${escapeHtml(worst.san)}</b> ${worst.count}/${r.total}×
          <span class="pill ${LEVELS[worst.level]}">${LEVELS[worst.level]}</span>${worst.book ? ' <span class="pill Book">Book</span>' : ""}</div>
        <div class="sub">Bad ${(r.badShare * 100).toFixed(0)}% of the time · avg loss ${r.avgCpl.toFixed(0)}cp · best: <b>${escapeHtml(uciToSan(r.fen, r.best) || r.best || "?")}</b></div>
      </div>`;
    card.addEventListener("click", () => selectPosition(r, card));
    el.appendChild(card);
  }
}

// ----------------------------- Rendering: board -----------------------------
const GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
function fenToGrid(fen) {
  const rows = fen.split(" ")[0].split("/");
  const grid = [];
  for (const row of rows) {
    const r = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) r.push(null);
      else r.push(ch);
    }
    grid.push(r);
  }
  return grid; // grid[0] = rank 8
}
function miniBoardSVG(fen, orient) {
  const grid = fenToGrid(fen);
  const flip = orient === "b";
  let cells = "";
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
      const light = (r + c) % 2 === 0;
      const x = dc * 10, y = dr * 10;
      cells += `<rect x="${x}" y="${y}" width="10" height="10" fill="${light ? "#b9c4d0" : "#63768a"}"/>`;
      const pc = grid[r][c];
      if (pc) {
        const isW = pc === pc.toUpperCase();
        cells += `<text x="${x + 5}" y="${y + 8}" font-size="9" text-anchor="middle" fill="${isW ? "#fbfdff" : "#1b1f27"}" stroke="${isW ? "#333" : "none"}" stroke-width="0.2">${GLYPH[pc.toLowerCase()]}</text>`;
      }
    }
  }
  return `<svg viewBox="0 0 80 80" width="80" height="80" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}

// Interactive board state for the detail panel
const boardState = { chess: null, orient: "w", sel: null, best: null, onMove: null };

function renderBoard() {
  const b = boardState;
  const grid = fenToGrid(b.chess.fen());
  const flip = b.orient === "b";
  const el = $("board");
  el.innerHTML = "";
  const legalTargets = b.sel ? new Set(b.chess.moves({ square: b.sel, verbose: true }).map((m) => m.to)) : new Set();
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
      const file = "abcdefgh"[c], rank = 8 - r, sq = file + rank;
      const light = (r + c) % 2 === 0;
      const cell = document.createElement("div");
      cell.className = "sq " + (light ? "light" : "dark");
      if (b.sel === sq) cell.classList.add("sel");
      const pc = grid[r][c];
      if (legalTargets.has(sq)) { cell.classList.add("legal"); if (pc) cell.classList.add("occupied"); }
      if (pc) {
        const span = document.createElement("span");
        span.className = "piece " + (pc === pc.toUpperCase() ? "w" : "b");
        span.textContent = GLYPH[pc.toLowerCase()];
        cell.appendChild(span);
      }
      if (dc === 0) cell.insertAdjacentHTML("beforeend", `<span class="coord rank">${rank}</span>`);
      if (dr === 7) cell.insertAdjacentHTML("beforeend", `<span class="coord file">${file}</span>`);
      cell.addEventListener("click", () => onSquareClick(sq));
      el.appendChild(cell);
    }
  }
  drawArrow();
}

function onSquareClick(sq) {
  const b = boardState;
  if (b.locked) return;
  const piece = b.chess.get(sq);
  if (b.sel) {
    const legal = b.chess.moves({ square: b.sel, verbose: true }).find((m) => m.to === sq);
    if (legal) {
      const needsPromo = legal.flags.indexOf("p") !== -1;
      const promo = needsPromo ? "q" : undefined;
      const from = b.sel, to = sq;
      b.sel = null;
      if (b.onMove) b.onMove(from, to, promo);
      return;
    }
  }
  if (piece && piece.color === b.chess.turn()) b.sel = sq; else b.sel = null;
  renderBoard();
}

function drawArrow() {
  const b = boardState;
  const el = $("board");
  const old = el.querySelector(".arrow-svg");
  if (old) old.remove();
  if (!b.best || b.best.length < 4) return;
  const flip = b.orient === "b";
  const sqXY = (s) => {
    const c = "abcdefgh".indexOf(s[0]), r = 8 - +s[1];
    const dc = flip ? 7 - c : c, dr = flip ? 7 - r : r;
    return [dc * 12.5 + 6.25, dr * 12.5 + 6.25];
  };
  const [x1, y1] = sqXY(b.best.slice(0, 2));
  const [x2, y2] = sqXY(b.best.slice(2, 4));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "arrow-svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.innerHTML = `
    <defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto">
      <path d="M0,0 L4,2 L0,4 Z" fill="rgba(110,168,254,.9)"/></marker></defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(110,168,254,.9)" stroke-width="1.8" marker-end="url(#ah)"/>`;
  el.appendChild(svg);
}

// ----------------------------- Detail / retry panel -----------------------------
let currentPos = null;

function selectPosition(r, cardEl) {
  currentPos = r;
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  if (cardEl) cardEl.classList.add("active");
  boardState.chess = new Chess(r.fen);
  boardState.orient = r.color;
  boardState.sel = null;
  boardState.best = null;
  boardState.locked = false;
  boardState.onMove = retryMove;

  const bestSan = uciToSan(r.fen, r.best) || r.best || "?";
  const histRows = r.plays.map((p) =>
    `<tr><td>${escapeHtml(p.san)}</td><td>${p.count}</td><td><span class="pill ${LEVELS[p.level]}">${LEVELS[p.level]}</span>${p.book ? ' <span class="pill Book">Book</span>' : ""}</td><td class="evalnum">${(p.cplSum / p.count).toFixed(0)}cp</td></tr>`
  ).join("");

  $("detail").innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${r.opening ? escapeHtml(r.opening) + " · " : ""}Move ${r.moveNo}</h2>
        <div class="statline">${r.phase} · ${r.color === "w" ? "White" : "Black"} to move · seen ${r.total}× · bad ${(r.badShare * 100).toFixed(0)}%</div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div class="btnrow">
        <button id="showBest">Show best move</button>
        <button id="resetBoard">Reset position</button>
        ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener"><button>Open a game ↗</button></a>` : ""}
      </div>
      <div id="feedback" class="feedback statline">Your move. Make a move on the board to see how it grades.</div>
    </div>
    <table class="hist">
      <thead><tr><th>Your past moves here</th><th>#</th><th>Grade</th><th>Avg loss</th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;

  renderBoard();
  $("showBest").addEventListener("click", () => {
    boardState.best = r.best; drawArrow();
    $("feedback").textContent = "Engine's best: " + bestSan + " (eval " + fmtEval(r.bestEval, r.color) + ").";
  });
  $("resetBoard").addEventListener("click", () => {
    boardState.chess = new Chess(r.fen); boardState.sel = null; boardState.best = null; boardState.locked = false;
    renderBoard();
    $("feedback").className = "feedback statline";
    $("feedback").textContent = "Your move. Make a move on the board to see how it grades.";
  });
}

async function retryMove(from, to, promo) {
  const r = currentPos;
  const test = new Chess(r.fen);
  const mv = test.move({ from, to, promotion: promo });
  if (!mv) return;
  boardState.locked = true;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback statline";
  fb.textContent = "Thinking…";
  const s = readSettings();
  let a;
  try {
    a = await analyzeMove({
      fenBefore: r.fen, fenAfter: test.fen(), uci: from + to + (promo || ""),
      terminalAfter: test.game_over(), matedAfter: test.in_checkmate(),
    }, s.depth, s.th);
  } catch (e) { fb.textContent = "Engine error: " + e.message; boardState.locked = false; return; }

  const level = a.level;
  const cls = level <= 1 ? "good" : level <= 2 ? "warn" : level >= 4 ? "bad" : "warn";
  const bestSan = uciToSan(r.fen, a.best) || a.best;
  const same = (from + to + (promo || "")) === a.best;
  fb.className = "feedback " + cls;
  fb.innerHTML = same
    ? `<b>${escapeHtml(mv.san)}</b> — <b>${LEVELS[level]}</b>! That's the engine's top move. ✔`
    : `<b>${escapeHtml(mv.san)}</b> — <b>${LEVELS[level]}</b> (loses ${a.cpl.toFixed(0)}cp). Best was <b>${escapeHtml(bestSan)}</b>.`;
  boardState.best = a.best;
  drawArrow();
  await sleep(650);
  boardState.locked = false;
}

// ----------------------------- utilities -----------------------------
function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return "";
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return mv ? mv.san : "";
  } catch (e) { return ""; }
}
function fmtEval(norm, color) {
  // norm is from the side-to-move (user) perspective, in clamped cp.
  const v = norm / 100;
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ----------------------------- run orchestration -----------------------------
function setBusy(busy) {
  $("run").disabled = busy;
  $("stop").disabled = !busy;
  $("progress").classList.toggle("hidden", !busy && $("barFill").style.width === "");
}
function onStatus(t) { $("status").textContent = t; }
function onProgress(f) { $("barFill").style.width = Math.round(f * 100) + "%"; }

async function ensureEngine() {
  if (engine && engine.worker) return;
  engine = new Engine();
  onStatus("Loading Stockfish engine…");
  await engine.init();
}

async function run(games) {
  const s = readSettings();
  if (!s.username && !games) { alert("Enter a Chess.com username."); return; }
  stopRequested = false;
  setBusy(true);
  $("progress").classList.remove("hidden");
  onProgress(0);
  try {
    await ensureEngine();
    if (!games) {
      onStatus("Fetching games from Chess.com…");
      games = await fetchGames(s.username, s.lookback, s.maxGames, onStatus);
      if (!games.length) { onStatus("No games found in that window. Check the username/lookback, or load a PGN file."); setBusy(false); return; }
    }
    lastResults = await runAnalysis(games, s, onStatus, onProgress);
    onProgress(1);
    if (s.bookMax > 0) await annotateBook(lastResults, s, onStatus);
    idb.set("sessions", "last", { savedAt: new Date().toISOString(), username: s.username, results: lastResults });
    $("exportBtn").disabled = false;
    renderList(); // recomputes flags (incl. book exclusions)
    const flagged = lastResults.filter((r) => r.flagged).length;
    onStatus(`Done. ${lastResults.length} unique positions analyzed, ${flagged} flagged.${stopRequested ? " (stopped early)" : ""}`);
  } catch (e) {
    onStatus("Error: " + e.message);
    console.error(e);
    if (/Failed to fetch|NetworkError|CORS/i.test(e.message)) {
      onStatus("Couldn't reach Chess.com from the browser (network/CORS). Try the “Load PGN file” option instead — export your games from chess.com.");
    }
  } finally {
    setBusy(false);
  }
}

// ----------------------------- PGN file import -----------------------------
function gamesFromPgnText(text) {
  // Split a multi-game PGN into individual games and wrap to mimic API objects.
  const chunks = text.split(/\n\n(?=\[Event )/).map((c) => c.trim()).filter(Boolean);
  const games = [];
  for (const pgn of chunks) {
    const site = pgnHeader(pgn, "Link") || pgnHeader(pgn, "Site") || "";
    games.push({
      pgn,
      rules: "chess",
      end_time: Math.floor(Date.now() / 1000),
      white: { username: pgnHeader(pgn, "White") },
      black: { username: pgnHeader(pgn, "Black") },
      url: /chess\.com/.test(site) ? site : "",
    });
  }
  return games;
}

// ----------------------------- wiring -----------------------------
function fillGradeSelectors() {
  for (const id of ["accOpen", "accMid", "accEnd"]) {
    const sel = $(id);
    LEVELS.forEach((lvl, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = lvl;
      sel.appendChild(o);
    });
  }
  $("accOpen").value = 1; // Excellent
  $("accMid").value = 2;  // Good
  $("accEnd").value = 3;  // Inaccuracy
}

async function restoreSession() {
  const saved = await idb.get("sessions", "last");
  if (!saved || !saved.results || !saved.results.length) return;
  lastResults = saved.results;
  if (saved.username) $("username").value = saved.username;
  $("exportBtn").disabled = false;
  $("progress").classList.remove("hidden");
  const cached = await idb.count("evals");
  onStatus(`Restored last analysis (${saved.username || "?"}, ${saved.results.length} positions, saved ${new Date(saved.savedAt).toLocaleString()}). ${cached} cached evals on disk.`);
  renderList();
  // Backfill book data for results analyzed before book support existed.
  const s = readSettings();
  if (s.bookMax > 0 && lastResults.some((r) => r.moveNo <= s.bookMax && !r.bookKnown)) {
    await annotateBook(lastResults, s, onStatus);
    idb.set("sessions", "last", { savedAt: saved.savedAt, username: saved.username, results: lastResults });
    renderList();
    onStatus("Opening-book check complete.");
  }
}

function init() {
  fillGradeSelectors();
  restoreSession();
  $("run").addEventListener("click", () => run(null));
  $("clearCache").addEventListener("click", async () => {
    await idb.clear("evals");
    await idb.clear("sessions");
    if (engine) engine.cache.clear();
    onStatus("Cleared saved evals and results.");
  });
  $("stop").addEventListener("click", () => { stopRequested = true; onStatus("Stopping after current move…"); });
  $("showAll").addEventListener("change", renderList);
  $("sortBy").addEventListener("change", renderList);
  $("ignoreBook").addEventListener("change", renderList);
  $("hideBefore").addEventListener("input", renderList);

  $("pgnFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    let text = "";
    for (const f of files) text += (await f.text()) + "\n\n";
    const games = gamesFromPgnText(text);
    const s = readSettings();
    // If the username matches a player in the PGNs use it; otherwise infer from first game.
    if (s.username) {
      const u = s.username.toLowerCase();
      const known = games.some((g) => [g.white.username, g.black.username].map((x) => (x || "").toLowerCase()).includes(u));
      if (!known && games[0]) {
        $("username").value = games[0].white.username || games[0].black.username || s.username;
        onStatus(`Username not found in PGN; using “${$("username").value}”. Edit it above if that's your opponent.`);
      }
    } else if (games[0]) {
      $("username").value = games[0].white.username || "";
    }
    run(games);
  });

  $("exportBtn").addEventListener("click", async () => {
    if (!lastResults) return;
    onStatus("Exporting results + eval cache…");
    const evals = await idb.entries("evals");
    const payload = {
      savedAt: new Date().toISOString(),
      username: $("username").value,
      settings: readSettings(),
      results: lastResults,
      evals, // engine cache: makes the file a full backup, portable across browsers
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chess-mistakes-" + ($("username").value || "results") + ".json";
    a.click();
    onStatus(`Exported ${lastResults.length} positions and ${Object.keys(evals).length} cached evals.`);
  });

  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      lastResults = data.results || data;
      if (data.username) $("username").value = data.username;
      let evalNote = "";
      if (data.evals && typeof data.evals === "object") {
        await idb.setMany("evals", data.evals);
        if (engine) for (const k in data.evals) engine.cache.set(k, data.evals[k]);
        evalNote = ` + ${Object.keys(data.evals).length} cached evals`;
      }
      idb.set("sessions", "last", { savedAt: data.savedAt || new Date().toISOString(), username: data.username || $("username").value, results: lastResults });
      $("exportBtn").disabled = false;
      onStatus(`Loaded ${lastResults.length} positions${evalNote} from file.`);
      renderList();
    } catch (err) { onStatus("Could not read results file: " + err.message); }
  });
}

document.addEventListener("DOMContentLoaded", init);
