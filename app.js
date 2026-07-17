/* Chess Mistake Trainer — UI layer.
 * DOM-only: reads settings from inputs, renders results/boards, wires events.
 * All logic lives in core.js (window.CMT). When overhauling this UI, the
 * contract to preserve is just the CMT API + the data model documented at the
 * top of core.js; run `npm test` to verify the core still behaves.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const { LEVELS } = CMT;

// ----------------------------- app state -----------------------------
let engine = null;          // CMT.Engine instance (created on first run)
let lastResults = null;     // Position[] currently displayed
let currentPos = null;      // Position selected in the detail panel
let isRunning = false;      // guards against concurrent runs
const control = { stop: false };

// ----------------------------- settings -----------------------------
// Read from the UI each time so changes take effect without reload.
function readSettings() {
  return {
    username: $("username").value.trim(),
    lookback: +$("lookback").value,
    maxGames: +$("maxGames").value || Infinity, // 0 or blank = unlimited
    maxMove: +$("maxMove").value,
    depth: CMT.clamp(+$("depth").value, 6, 20),
    th: {
      Best: +$("thBest").value, Excellent: +$("thExc").value, Good: +$("thGood").value,
      Inaccuracy: +$("thInacc").value, Mistake: +$("thMist").value,
    },
    phases: {
      openEnd: +$("phOpenEnd").value,
      midEnd: +$("phMidEnd").value,
      accOpen: +$("accOpen").value,
      accMid: +$("accMid").value,
      accEnd: +$("accEnd").value,
    },
    flagShare: CMT.clamp(+$("flagShare").value, 0, 1),
    minOcc: Math.max(1, +$("minOcc").value),
    bookMax: +$("bookMax").value,
  };
}

// ----------------------------- status / progress -----------------------------
function onStatus(t) { $("status").textContent = t; }
function onProgress(f) { $("barFill").style.width = Math.round(f * 100) + "%"; }
function setBusy(busy) {
  isRunning = busy;
  $("run").disabled = busy;
  $("stop").disabled = !busy;
}

async function ensureEngine() {
  if (engine && engine.worker) return;
  if (!engine) engine = new CMT.Engine();
  onStatus("Loading Stockfish engine…");
  await engine.init();
}

// ----------------------------- run orchestration -----------------------------
async function run(games) {
  if (isRunning) return;
  const s = readSettings();
  if (!s.username && !games) { alert("Enter a Chess.com username."); return; }
  control.stop = false;
  setBusy(true);
  $("progress").classList.remove("hidden");
  onProgress(0);
  try {
    await ensureEngine();
    if (!games) {
      onStatus("Fetching games from Chess.com…");
      games = await CMT.fetchGames(s.username, s.lookback, s.maxGames, onStatus);
      if (!games.length) {
        onStatus("No games found in that window. Check the username/lookback, or load a PGN file.");
        return;
      }
    }
    lastResults = await CMT.runAnalysis(games, s, { engine, onStatus, onProgress, control });
    onProgress(1);
    if (s.bookMax > 0) await CMT.annotateBook(lastResults, s, { onStatus, control });
    CMT.saveSession(s.username, lastResults);
    $("exportBtn").disabled = false;
    renderList();
    const flagged = lastResults.filter((r) => r.flagged).length;
    onStatus(`Done. ${lastResults.length} unique positions analyzed, ${flagged} flagged.${control.stop ? " (stopped early)" : ""}`);
  } catch (e) {
    console.error(e);
    if (/Failed to fetch|NetworkError|CORS/i.test(e.message)) {
      onStatus("Couldn't reach Chess.com from the browser (network/CORS). Try “Load PGN file” instead — export your games from chess.com.");
    } else {
      onStatus("Error: " + e.message);
    }
    if (lastResults) renderList(); // show partial results if we have any
  } finally {
    setBusy(false);
  }
}

// ----------------------------- results list -----------------------------
// Mini-board SVGs are pure functions of (fen, orientation): memoize across renders.
const miniBoardCache = new Map();
function miniBoardSVG(fen, orient) {
  const ck = orient + "|" + fen;
  let svg = miniBoardCache.get(ck);
  if (svg) return svg;
  const grid = CMT.fenToGrid(fen);
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
  svg = `<svg viewBox="0 0 80 80" width="80" height="80" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
  if (miniBoardCache.size > 2000) miniBoardCache.clear();
  miniBoardCache.set(ck, svg);
  return svg;
}

function pills(level, isBook, isIgnored) {
  let h = `<span class="pill ${LEVELS[level]}">${LEVELS[level]}</span>`;
  if (isBook) h += ' <span class="pill Book">Book</span>';
  if (isIgnored) h += ' <span class="pill Ignored">Ignored</span>';
  return h;
}

function renderList() {
  if (!lastResults) return;
  const showAll = $("showAll").checked;
  const hideBefore = +$("hideBefore").value || 0;
  CMT.recomputeFlags(lastResults, readSettings(), $("ignoreBook").checked, CMT.customBook.set);
  let list = lastResults.filter((r) => (showAll || r.flagged) && r.moveNo > hideBefore);
  list = CMT.sortResults(list, $("sortBy").value);
  const el = $("results");
  if (!list.length) {
    el.innerHTML = `<p class="empty">${lastResults.length
      ? "No positions matched the flagging criteria. Try “show all”, lower the flag share, or loosen the acceptable grades."
      : "No positions analyzed."}</p>`;
    return;
  }
  el.innerHTML = "";
  for (const r of list) {
    const worst = r.plays[0];
    const card = document.createElement("div");
    card.className = "card" + (currentPos && currentPos.key === r.key ? " active" : "");
    card.dataset.key = r.key;
    card.innerHTML = `
      <div class="thumb">${miniBoardSVG(r.fen, r.color)}</div>
      <div>
        <div class="meta-top">
          ${r.opening ? `<span class="opening">${CMT.escapeHtml(r.opening)}</span>` : ""}
          <span class="sub">Move ${r.moveNo} · ${r.phase} · ${r.color === "w" ? "White" : "Black"}</span>
        </div>
        <div class="line">You played <b>${CMT.escapeHtml(worst.san)}</b> ${worst.count}/${r.total}×
          ${pills(worst.level, worst.book, CMT.customBook.set.has(r.key + "|" + worst.uci))}</div>
        <div class="sub">Bad ${(r.badShare * 100).toFixed(0)}% of the time · avg loss ${r.avgCpl.toFixed(0)}cp · best: <b>${CMT.escapeHtml(CMT.uciToSan(r.fen, r.best) || r.best || "?")}</b></div>
      </div>`;
    card.addEventListener("click", () => selectPosition(r, card));
    el.appendChild(card);
  }
}

// ----------------------------- interactive board -----------------------------
const GLYPH = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
const boardState = { chess: null, orient: "w", sel: null, best: null, locked: false, onMove: null };

function renderBoard() {
  const b = boardState;
  const grid = CMT.fenToGrid(b.chess.fen());
  const flip = b.orient === "b";
  const el = $("board");
  el.innerHTML = "";
  const legalTargets = b.sel ? new Set(b.chess.moves({ square: b.sel, verbose: true }).map((m) => m.to)) : new Set();
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
      const file = "abcdefgh"[c], rank = 8 - r, sq = file + rank;
      const cell = document.createElement("div");
      cell.className = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
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
      const promo = legal.flags.indexOf("p") !== -1 ? "q" : undefined; // auto-queen
      const from = b.sel;
      b.sel = null;
      if (b.onMove) b.onMove(from, sq, promo);
      return;
    }
  }
  b.sel = piece && piece.color === b.chess.turn() ? sq : null;
  renderBoard();
}

function drawArrow() {
  const b = boardState;
  const el = $("board");
  if (!el) return;
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

// ----------------------------- detail / retry panel -----------------------------
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

  const bestSan = CMT.uciToSan(r.fen, r.best) || r.best || "?";
  const histRows = r.plays.map((p) => {
    const ig = CMT.customBook.set.has(r.key + "|" + p.uci);
    return `<tr><td>${CMT.escapeHtml(p.san)}</td><td>${p.count}</td>
      <td>${pills(p.level, p.book, ig)}</td>
      <td class="evalnum">${(p.cplSum / p.count).toFixed(0)}cp</td>
      <td><button class="igbtn" data-uci="${p.uci}" data-san="${CMT.escapeHtml(p.san)}">${ig ? "unignore" : "ignore"}</button></td></tr>`;
  }).join("");

  $("detail").innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${r.opening ? CMT.escapeHtml(r.opening) + " · " : ""}Move ${r.moveNo}</h2>
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
      <thead><tr><th>Your past moves here</th><th>#</th><th>Grade</th><th>Avg loss</th><th></th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;

  renderBoard();
  document.querySelectorAll(".igbtn").forEach((b) => b.addEventListener("click", () => {
    CMT.toggleManualIgnore(r, b.dataset.uci, b.dataset.san);
    renderCustomBook();
    renderList();
    const el = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === r.key);
    selectPosition(r, el || null);
  }));
  $("showBest").addEventListener("click", () => {
    boardState.best = r.best;
    drawArrow();
    $("feedback").textContent = "Engine's best: " + bestSan + " (eval " + CMT.fmtEval(r.bestEval) + ").";
  });
  $("resetBoard").addEventListener("click", () => {
    boardState.chess = new Chess(r.fen);
    boardState.sel = null; boardState.best = null; boardState.locked = false;
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
    await ensureEngine(); // restored sessions may not have started the engine yet
    a = await CMT.analyzeMove({
      fenBefore: r.fen, fenAfter: test.fen(), uci: from + to + (promo || ""),
      terminalAfter: test.game_over(), matedAfter: test.in_checkmate(),
    }, s.depth, s.th, engine);
  } catch (e) {
    fb.textContent = "Engine error: " + e.message;
    boardState.locked = false;
    return;
  }
  const cls = a.level <= 1 ? "good" : a.level >= 4 ? "bad" : "warn";
  const bestSan = CMT.uciToSan(r.fen, a.best) || a.best;
  const same = (from + to + (promo || "")) === a.best;
  fb.className = "feedback " + cls;
  fb.innerHTML = same
    ? `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b>! That's the engine's top move. ✔`
    : `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b> (loses ${a.cpl.toFixed(0)}cp). Best was <b>${CMT.escapeHtml(bestSan)}</b>.`;
  boardState.best = a.best;
  drawArrow();
  await CMT.sleep(650);
  boardState.locked = false;
}

// ----------------------------- custom lines panel -----------------------------
function renderCustomBook() {
  const el = $("customList");
  if (!el) return;
  const groups = CMT.customBook.groups;
  if (!groups.length) { el.innerHTML = '<p class="hint">No custom lines yet.</p>'; return; }
  el.innerHTML = "";
  for (const g of groups) {
    const row = document.createElement("div");
    row.className = "cbrow";
    row.innerHTML = `<span class="cbl">${CMT.escapeHtml(g.label)}</span><span class="hint">${g.pairs.length} move${g.pairs.length === 1 ? "" : "s"}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = "Remove";
    btn.addEventListener("click", () => { CMT.removeCustomGroup(g); renderCustomBook(); renderList(); });
    row.appendChild(btn);
    el.appendChild(row);
  }
}

// ----------------------------- session restore -----------------------------
async function restoreSession() {
  const saved = await CMT.loadSession();
  if (!saved) return;
  lastResults = saved.results;
  if (saved.username) $("username").value = saved.username;
  $("exportBtn").disabled = false;
  $("progress").classList.remove("hidden");
  const cached = await CMT.storage.count("evals");
  onStatus(`Restored last analysis (${saved.username || "?"}, ${saved.results.length} positions, saved ${new Date(saved.savedAt).toLocaleString()}). ${cached} cached evals on disk.`);
  renderList();
  // Backfill book data for results analyzed before book support existed.
  const s = readSettings();
  if (s.bookMax > 0 && lastResults.some((r) => r.moveNo <= s.bookMax && !r.bookKnown)) {
    await CMT.annotateBook(lastResults, s, { onStatus, control });
    CMT.saveSession(saved.username, lastResults);
    renderList();
    onStatus("Opening-book check complete.");
  }
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

function init() {
  fillGradeSelectors();
  CMT.loadCustomBook().then(() => { renderCustomBook(); return restoreSession(); });

  $("run").addEventListener("click", () => run(null));
  $("stop").addEventListener("click", () => { control.stop = true; onStatus("Stopping after current move…"); });

  // list controls — all instant, no re-analysis
  for (const [id, evt] of [["showAll", "change"], ["sortBy", "change"], ["ignoreBook", "change"], ["hideBefore", "input"]]) {
    $(id).addEventListener(evt, renderList);
  }

  $("addLine").addEventListener("click", () => {
    const text = $("lineInput").value.trim();
    if (!text) return;
    try {
      const pairs = CMT.addCustomLine(text);
      renderCustomBook();
      renderList();
      $("lineInput").value = "";
      onStatus(`Added line (${pairs.length} moves) to your ignored lines.`);
    } catch (e) { onStatus("Could not parse line: " + e.message); }
  });
  $("lineInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("addLine").click(); });

  $("clearCache").addEventListener("click", async () => {
    await CMT.clearCaches(engine);
    onStatus("Cleared saved evals and results (your custom lines were kept).");
  });

  $("pgnFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = ""; // allow re-selecting the same file later
    if (!files.length || isRunning) return;
    let text = "";
    for (const f of files) text += (await f.text()) + "\n\n";
    const games = CMT.gamesFromPgnText(text);
    const s = readSettings();
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
    const payload = await CMT.buildExport($("username").value, readSettings(), lastResults);
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chess-mistakes-" + ($("username").value || "results") + ".json";
    a.click();
    onStatus(`Exported ${lastResults.length} positions and ${Object.keys(payload.evals).length} cached evals.`);
  });

  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const { results, summary } = await CMT.applyImport(data, engine);
      lastResults = results;
      if (summary.username) $("username").value = summary.username;
      $("exportBtn").disabled = false;
      renderCustomBook();
      renderList();
      onStatus(`Loaded ${summary.positions} positions`
        + (summary.evals ? ` + ${summary.evals} cached evals` : "")
        + (summary.customGroups ? ` + ${summary.customGroups} custom line group(s)` : "")
        + " from file.");
    } catch (err) { onStatus("Could not read results file: " + err.message); }
  });

  // Best-effort persistence of any queued eval writes when the tab closes.
  window.addEventListener("pagehide", () => { CMT.storage.flush(); });
}

document.addEventListener("DOMContentLoaded", init);
