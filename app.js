/* Chess Mistake Trainer — UI layer ("Midnight club" / "Blush studio" design).
 * DOM-only: settings, rendering, events, theme UI, board interaction.
 * All logic lives in core.js (CMT); themes in themes.js (Themes).
 * Contract: the CMT API + data model documented in core.js. `npm test` green
 * means the core still behaves.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const { LEVELS } = CMT;
const MOBILE = () => window.innerWidth < 900;

// ----------------------------- app state -----------------------------
let engine = null;
let lastResults = null;
let currentPos = null;
let currentList = [];      // rendered order, for keyboard nav + "Next"
let isRunning = false;
const control = { stop: false };

// ----------------------------- settings -----------------------------
function readSettings() {
  return {
    username: $("username").value.trim(),
    lookback: +$("lookback").value,
    maxGames: +$("maxGames").value || Infinity,
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
  if (!s.username && !games) { onStatus("Enter a Chess.com username first."); return; }
  control.stop = false;
  setBusy(true);
  onProgress(0);
  try {
    await ensureEngine();
    if (!games) {
      onStatus("Fetching games from Chess.com…");
      games = await CMT.fetchGames(s.username, s.lookback, s.maxGames, onStatus);
      if (!games.length) {
        onStatus("No games found in that window. Check the username/lookback, or load a PGN file (Settings → Data).");
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
      onStatus("Couldn't reach Chess.com (network/CORS). Load a PGN file instead — Settings → Data.");
    } else {
      onStatus("Error: " + e.message);
    }
    if (lastResults) renderList();
  } finally {
    setBusy(false);
  }
}

// ----------------------------- SVG pieces -----------------------------
// Minimalist geometric set, 45x45 viewBox. Same shapes at every size.
const PIECE_SHAPES = {
  p: `<circle cx="22.5" cy="13.5" r="5.5"/>
      <path d="M22.5,19 C18.5,22.5 17.2,27.5 16.2,32.5 L28.8,32.5 C27.8,27.5 26.5,22.5 22.5,19 Z"/>
      <rect x="13.5" y="33" width="18" height="4.5" rx="2"/>`,
  r: `<path d="M14,10.5 H18 V14 H20.7 V10.5 H24.3 V14 H27 V10.5 H31 V16.5 H28.5 V30.5 H16.5 V16.5 H14 Z"/>
      <rect x="13" y="31.5" width="19" height="3" rx="1.5"/>
      <rect x="12.5" y="35" width="20" height="3.5" rx="1.75"/>`,
  n: `<path d="M17,36 V29 C14,26.5 13,23 14,19.5 C15.5,14 20,10.5 25.5,10.5 L24.5,13.5 C28.5,14.5 31,18 31,22 C31,24.5 30,26.5 28,28 V36 Z"/>
      <path d="M24,10.8 L26.5,6.5 L27.6,11.2 Z"/>
      <circle class="eye" cx="24.5" cy="16.8" r="1.3"/>`,
  b: `<circle cx="22.5" cy="8.6" r="2.2"/>
      <path d="M22.5,12 C26.5,15.5 28.5,19.5 28.5,23.5 C28.5,28 26,30.8 22.5,30.8 C19,30.8 16.5,28 16.5,23.5 C16.5,19.5 18.5,15.5 22.5,12 Z"/>
      <path class="slit" d="M22.5,17 V24 M19.3,20.5 H25.7" fill="none"/>
      <rect x="14.5" y="32.5" width="16" height="4.5" rx="2"/>`,
  q: `<path d="M13.5,32.5 L11.5,16.5 L17.5,23 L22.5,12.5 L27.5,23 L33.5,16.5 L31.5,32.5 Z"/>
      <circle cx="11.5" cy="14.7" r="1.9"/><circle cx="22.5" cy="10.6" r="1.9"/><circle cx="33.5" cy="14.7" r="1.9"/>
      <rect x="13" y="33.5" width="19" height="4.5" rx="2"/>`,
  k: `<rect x="21.6" y="5" width="1.8" height="7.4" rx=".9"/>
      <rect x="18.8" y="7.3" width="7.4" height="1.8" rx=".9"/>
      <path d="M15,32.5 L13.5,20 C13.5,16 17,13.5 20.5,14.5 C21.3,14.8 22,15.4 22.5,16.2 C23,15.4 23.7,14.8 24.5,14.5 C28,13.5 31.5,16 31.5,20 L30,32.5 Z"/>
      <rect x="13" y="33.5" width="19" height="4.5" rx="2"/>`,
};
function pieceInner(pc) {
  const isW = pc === pc.toUpperCase();
  const f = isW ? "#f4f1ea" : "#33302c";
  const st = isW ? "#3a3733" : "#d8d2c8";
  let body = PIECE_SHAPES[pc.toLowerCase()]
    .replace('class="eye"', `fill="${st}" stroke="none"`)
    .replace('class="slit"', `stroke="${st}" stroke-width="1.4"`);
  return `<g fill="${f}" stroke="${st}" stroke-width="1.6" stroke-linejoin="round">${body}</g>`;
}
function pieceSVG(pc) {
  return `<svg class="piece" viewBox="0 0 45 45" aria-hidden="true">${pieceInner(pc)}</svg>`;
}

// ----------------------------- results list -----------------------------
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
      cells += `<rect x="${x}" y="${y}" width="10" height="10" class="${light ? "ml" : "md"}"/>`;
      const pc = grid[r][c];
      if (pc) cells += `<svg x="${x}" y="${y}" width="10" height="10" viewBox="0 0 45 45">${pieceInner(pc)}</svg>`;
    }
  }
  svg = `<svg viewBox="0 0 80 80" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
    <style>.ml{fill:var(--sq-light)}.md{fill:var(--sq-dark)}</style>${cells}</svg>`;
  if (miniBoardCache.size > 2000) miniBoardCache.clear();
  miniBoardCache.set(ck, svg);
  return svg;
}

const GRADE_VARS = ["--best", "--excellent", "--good", "--inacc", "--mistake", "--blunder"];
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
  currentList = list;
  const el = $("results");
  if (!list.length) {
    el.innerHTML = `<div class="hero"><div class="hero-board" aria-hidden="true"></div>
      <h2>${lastResults.length ? "Nothing repeatedly wrong here" : "No positions analyzed"}</h2>
      <p>${lastResults.length
        ? "No positions matched the flagging criteria — nice. Try “show all”, lower the flag share, or widen the lookback to dig deeper."
        : "Run an analysis to get started."}</p></div>`;
    return;
  }
  el.innerHTML = "";
  for (const r of list) {
    const worst = r.plays[0];
    const card = document.createElement("div");
    card.className = "card" + (currentPos && currentPos.key === r.key ? " active" : "");
    card.dataset.key = r.key;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    const sevColor = GRADE_VARS[Math.min(5, worst.level)];
    card.innerHTML = `
      <div class="thumb">${miniBoardSVG(r.fen, r.color)}</div>
      <div>
        ${r.opening ? `<span class="opening">${CMT.escapeHtml(r.opening)}</span> ` : ""}<span class="meta">Move ${r.moveNo} · ${r.phase} · ${r.color === "w" ? "White" : "Black"}</span>
        <div class="line">You played <b>${CMT.escapeHtml(worst.san)}</b> ${worst.count}/${r.total}×
          ${pills(worst.level, worst.book, CMT.customBook.set.has(r.key + "|" + worst.uci))}</div>
        <div class="sevbar"><span style="width:${Math.round(r.badShare * 100)}%;background:var(${sevColor})"></span></div>
        <div class="meta">bad ${(r.badShare * 100).toFixed(0)}% · avg loss ${r.avgCpl.toFixed(0)}cp · best <b>${CMT.escapeHtml(CMT.uciToSan(r.fen, r.best) || r.best || "?")}</b></div>
      </div>
      <span class="chev">›</span>`;
    card.addEventListener("click", () => selectPosition(r, card));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPosition(r, card); } });
    el.appendChild(card);
  }
}

// ----------------------------- interactive board -----------------------------
const boardState = { chess: null, orient: "w", sel: null, best: null, locked: false, onMove: null };
let suppressClick = false;

function renderBoard() {
  const b = boardState;
  const el = $("board");
  if (!el) return;
  const grid = CMT.fenToGrid(b.chess.fen());
  const flip = b.orient === "b";
  el.innerHTML = "";
  const legalTargets = b.sel ? new Set(b.chess.moves({ square: b.sel, verbose: true }).map((m) => m.to)) : new Set();
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr, c = flip ? 7 - dc : dc;
      const file = "abcdefgh"[c], rank = 8 - r, sq = file + rank;
      const cell = document.createElement("div");
      cell.className = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
      cell.dataset.sq = sq;
      if (b.sel === sq) cell.classList.add("sel");
      const pc = grid[r][c];
      if (legalTargets.has(sq)) { cell.classList.add("legal"); if (pc) cell.classList.add("occupied"); }
      if (pc) cell.innerHTML = pieceSVG(pc);
      if (dc === 0) cell.insertAdjacentHTML("beforeend", `<span class="coord rank">${rank}</span>`);
      if (dr === 7) cell.insertAdjacentHTML("beforeend", `<span class="coord file">${file}</span>`);
      cell.addEventListener("click", () => { if (!suppressClick) onSquareClick(sq); });
      cell.addEventListener("pointerdown", (e) => onPointerDown(e, sq, pc));
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
      const promo = legal.flags.indexOf("p") !== -1 ? "q" : undefined;
      const from = b.sel;
      b.sel = null;
      if (b.onMove) b.onMove(from, sq, promo);
      return;
    }
  }
  b.sel = piece && piece.color === b.chess.turn() ? sq : null;
  renderBoard();
}

// Drag support (additive to tap-tap): drag your own piece to a legal square.
function onPointerDown(e, sq, pc) {
  const b = boardState;
  if (b.locked || !pc) return;
  const piece = b.chess.get(sq);
  if (!piece || piece.color !== b.chess.turn()) return;
  const startX = e.clientX, startY = e.clientY;
  let dragging = false, ghost = null;

  const move = (ev) => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) {
      dragging = true;
      b.sel = sq;
      renderBoard();
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.innerHTML = pieceSVG(pc);
      document.body.appendChild(ghost);
    }
    if (ghost) {
      ghost.style.left = (ev.clientX - 28) + "px";
      ghost.style.top = (ev.clientY - 28) + "px";
    }
  };
  const up = (ev) => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    if (ghost) ghost.remove();
    if (!dragging) return; // plain click → handled by the click event
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const cell = document.elementFromPoint(ev.clientX, ev.clientY);
    const target = cell && cell.closest ? (cell.closest(".sq") || {}).dataset : null;
    const to = target && target.sq;
    const legal = to && b.chess.moves({ square: sq, verbose: true }).find((m) => m.to === to);
    b.sel = null;
    if (legal && b.onMove) {
      b.onMove(sq, to, legal.flags.indexOf("p") !== -1 ? "q" : undefined);
    } else {
      renderBoard();
    }
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
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
      <path d="M0,0 L4,2 L0,4 Z" fill="var(--accent)"/></marker></defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" marker-end="url(#ah)" opacity="0.9"/>`;
  el.appendChild(svg);
}

// ----------------------------- trainer panel -----------------------------
function countUp(el, target, suffix) {
  const t0 = performance.now();
  const tick = (t) => {
    const f = Math.min(1, (t - t0) / 200);
    el.textContent = Math.round(target * f) + suffix;
    if (f < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function openTrainer() {
  if (!MOBILE()) return;
  if (!document.body.classList.contains("trainer-open")) {
    document.body.classList.add("trainer-open");
    history.pushState({ trainer: 1 }, "");
  }
}
function closeTrainer() { document.body.classList.remove("trainer-open"); }

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

  const histRows = r.plays.map((p) => {
    const ig = CMT.customBook.set.has(r.key + "|" + p.uci);
    return `<tr><td><b>${CMT.escapeHtml(p.san)}</b></td><td>${p.count}</td>
      <td>${pills(p.level, p.book, ig)}</td>
      <td class="evalnum">${(p.cplSum / p.count).toFixed(0)}cp</td>
      <td><button class="igbtn" data-uci="${p.uci}" data-san="${CMT.escapeHtml(p.san)}">${ig ? "unignore" : "ignore"}</button></td></tr>`;
  }).join("");

  const idx = currentList.indexOf(r);
  const hasNext = idx >= 0 && idx < currentList.length - 1;

  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="backBtn" aria-label="Back to list">←</button>
      <div>
        <h2>${r.opening ? CMT.escapeHtml(r.opening) + " · " : ""}Move ${r.moveNo}</h2>
        <div class="statline">${r.phase} · ${r.color === "w" ? "White" : "Black"} to move · seen ${r.total}× · bad <span id="badPct">0%</span></div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div id="feedback" class="feedback" aria-live="polite">Your move. Play the move you think is best.</div>
      <div class="btnrow mobile-actions">
        <button id="showBest">Show best</button>
        <button id="resetBoard">Reset</button>
        <button id="nextPos" class="next" ${hasNext ? "" : "disabled"}>Next →</button>
        ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener"><button>Game ↗</button></a>` : ""}
      </div>
    </div>
    <table class="hist">
      <thead><tr><th>Your moves here</th><th>#</th><th>Grade</th><th>Avg loss</th><th></th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;

  renderBoard();
  countUp($("badPct"), Math.round(r.badShare * 100), "%");

  $("backBtn").addEventListener("click", () => {
    if (history.state && history.state.trainer) history.back(); else closeTrainer();
  });
  document.querySelectorAll(".igbtn").forEach((b) => b.addEventListener("click", () => {
    CMT.toggleManualIgnore(r, b.dataset.uci, b.dataset.san);
    renderCustomBook();
    renderList();
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === r.key);
    selectPosition(r, el2 || null);
  }));
  $("showBest").addEventListener("click", () => {
    boardState.best = r.best;
    drawArrow();
    const bestSan = CMT.uciToSan(r.fen, r.best) || r.best || "?";
    const fb = $("feedback");
    fb.className = "feedback";
    fb.innerHTML = `Engine's best: <b>${CMT.escapeHtml(bestSan)}</b> (eval ${CMT.fmtEval(r.bestEval)}).`;
  });
  $("resetBoard").addEventListener("click", resetCurrent);
  $("nextPos").addEventListener("click", () => {
    const i = currentList.indexOf(currentPos);
    const next = currentList[i + 1];
    if (!next) return;
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === next.key);
    selectPosition(next, el2 || null);
    if (el2 && !MOBILE()) el2.scrollIntoView({ block: "nearest" });
  });

  openTrainer();
}

function resetCurrent() {
  const r = currentPos;
  if (!r) return;
  boardState.chess = new Chess(r.fen);
  boardState.sel = null; boardState.best = null; boardState.locked = false;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback";
  fb.textContent = "Your move. Play the move you think is best.";
}

async function retryMove(from, to, promo) {
  const r = currentPos;
  const test = new Chess(r.fen);
  const mv = test.move({ from, to, promotion: promo });
  if (!mv) return;
  boardState.locked = true;
  boardState.chess = test;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback";
  fb.textContent = "Thinking…";
  const s = readSettings();
  let a;
  try {
    await ensureEngine();
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
  const same = (from + to + (promo || "")) === a.best || a.cpl === 0;
  fb.className = "feedback " + cls + (cls === "good" ? " pop" : "");
  fb.innerHTML = same
    ? `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b>! The engine agrees. Hit <b>Next</b> to keep the streak going.`
    : `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b> (loses ${a.cpl.toFixed(0)}cp). Best was <b>${CMT.escapeHtml(bestSan)}</b>. <button class="igbtn" id="tryAgain">Try again</button>`;
  const ta = $("tryAgain");
  if (ta) ta.addEventListener("click", resetCurrent);
  boardState.best = a.best;
  drawArrow();
  await CMT.sleep(500);
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
    btn.setAttribute("aria-label", "Remove line");
    btn.addEventListener("click", () => { CMT.removeCustomGroup(g); renderCustomBook(); renderList(); });
    row.appendChild(btn);
    el.appendChild(row);
  }
}

// ----------------------------- theme UI -----------------------------
const TE_GROUPS = [
  ["Backgrounds", ["bg", "surface1", "surface2", "surface3"]],
  ["Text", ["text", "muted", "faint"]],
  ["Accent", ["accent"]],
  ["Grades", ["best", "excellent", "good", "inacc", "mistake", "blunder"]],
  ["Board", ["sqLight", "sqDark", "sqSel"]],
];
const TE_LABELS = {
  bg: "Page", surface1: "Panel", surface2: "Card", surface3: "Raised",
  text: "Primary", muted: "Secondary", faint: "Hints",
  accent: "Accent", best: "Best", excellent: "Excellent", good: "Good",
  inacc: "Inaccuracy", mistake: "Mistake", blunder: "Blunder",
  sqLight: "Light squares", sqDark: "Dark squares", sqSel: "Selection",
};
let editingTheme = null;

function luminance(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function renderThemeUI() {
  const prefs = Themes.prefs();
  $("useSystem").checked = prefs.useSystem;
  for (const [selId, base, cur] of [["lightTheme", "light", prefs.lightTheme], ["darkTheme", "dark", prefs.darkTheme]]) {
    const sel = $(selId);
    sel.innerHTML = "";
    for (const t of Themes.byBase(base)) {
      const o = document.createElement("option");
      o.value = t.id; o.textContent = t.name;
      sel.appendChild(o);
    }
    sel.value = cur;
  }
  const list = $("themeList");
  list.innerHTML = "";
  for (const t of Themes.all()) {
    const row = document.createElement("div");
    row.className = "themerow";
    const dots = ["bg", "surface2", "accent", "sqDark"].map((k) => `<i style="background:${t.colors[k]}"></i>`).join("");
    row.innerHTML = `<span class="dotstrip">${dots}</span><span class="tname">${CMT.escapeHtml(t.name)}</span><span class="tbase">${t.base}</span>`;
    const dup = document.createElement("button");
    dup.textContent = "Duplicate";
    dup.addEventListener("click", () => { const c = Themes.duplicate(t.id); renderThemeUI(); openThemeEditor(c); });
    row.appendChild(dup);
    if (!t.builtin) {
      const ed = document.createElement("button");
      ed.textContent = "Edit";
      ed.addEventListener("click", () => openThemeEditor(t));
      row.appendChild(ed);
    }
    list.appendChild(row);
  }
}

function openThemeEditor(theme) {
  if (!theme) return;
  editingTheme = theme;
  $("themeEditor").hidden = false;
  $("teName").value = theme.name;
  $("teBase").value = theme.base;
  const fields = $("teFields");
  fields.innerHTML = "";
  for (const [group, keys] of TE_GROUPS) {
    fields.insertAdjacentHTML("beforeend", `<span class="te-group">${group}</span>`);
    for (const key of keys) {
      const label = document.createElement("label");
      label.innerHTML = `<span>${TE_LABELS[key]}</span>`;
      const input = document.createElement("input");
      input.type = "color";
      input.value = theme.colors[key];
      input.addEventListener("input", () => {
        editingTheme.colors[key] = input.value;
        previewEditing();
      });
      label.appendChild(input);
      fields.appendChild(label);
    }
  }
  previewEditing();
}

function previewEditing() {
  const t = editingTheme;
  if (!t) return;
  // Live-apply the edited colors to the whole app.
  const root = document.documentElement;
  for (const key in Themes.VARMAP) {
    if (t.colors[key]) root.style.setProperty(Themes.VARMAP[key], t.colors[key]);
  }
  root.style.setProperty("--accent-soft", t.colors.accent + "33");
  root.style.setProperty("--danger", t.colors.blunder);
  root.style.setProperty("--success", t.colors.best);
  // Contrast check: warn below 4.5:1, never block.
  const checks = [
    ["Primary text on cards", t.colors.text, t.colors.surface2],
    ["Primary text on page", t.colors.text, t.colors.bg],
    ["Secondary text on panels", t.colors.muted, t.colors.surface1],
  ];
  const bad = checks.filter(([, a, b]) => contrast(a, b) < 4.5);
  const warn = $("teWarning");
  if (bad.length) {
    warn.hidden = false;
    warn.textContent = "Low contrast (< 4.5:1): " + bad.map(([n]) => n).join(", ") + ". Saving is allowed — your call.";
  } else {
    warn.hidden = true;
  }
}

function closeThemeEditor() {
  editingTheme = null;
  $("themeEditor").hidden = true;
  Themes.apply(); // restore the real active theme
}

// ----------------------------- drawer -----------------------------
function setDrawer(open) {
  const d = $("drawer"), s = $("drawerScrim");
  if (open) {
    d.hidden = false; s.hidden = false;
    requestAnimationFrame(() => { d.classList.add("show"); s.classList.add("show"); });
  } else {
    d.classList.remove("show"); s.classList.remove("show");
    setTimeout(() => { d.hidden = true; s.hidden = true; }, 240);
  }
}

// ----------------------------- session restore -----------------------------
async function restoreSession() {
  const saved = await CMT.loadSession();
  if (!saved) return;
  lastResults = saved.results;
  if (saved.username) $("username").value = saved.username;
  $("exportBtn").disabled = false;
  const cached = await CMT.storage.count("evals");
  onStatus(`Restored last analysis (${saved.username || "?"}, ${saved.results.length} positions). ${cached} cached evals on disk.`);
  renderList();
  const s = readSettings();
  if (s.bookMax > 0 && lastResults.some((r) => r.moveNo <= s.bookMax && !r.bookKnown)) {
    await CMT.annotateBook(lastResults, s, { onStatus, control });
    CMT.saveSession(saved.username, lastResults);
    renderList();
    onStatus("Opening-book check complete.");
  }
}

// ----------------------------- keyboard -----------------------------
function onKeydown(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return;
  if (e.key === "Escape") {
    if ($("drawer").classList.contains("show")) { setDrawer(false); return; }
    if (document.body.classList.contains("trainer-open")) { closeTrainer(); return; }
  }
  if (!currentList.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const i = currentPos ? currentList.indexOf(currentPos) : -1;
    const j = e.key === "ArrowDown" ? Math.min(currentList.length - 1, i + 1) : Math.max(0, i - 1);
    const r = currentList[j];
    if (!r || r === currentPos) return;
    const el = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === r.key);
    selectPosition(r, el || null);
    if (el) el.scrollIntoView({ block: "nearest" });
  } else if (e.key === "b" || e.key === "B") {
    const btn = $("showBest");
    if (btn) btn.click();
  } else if (e.key === "r" || e.key === "R") {
    const btn = $("resetBoard");
    if (btn) btn.click();
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
  $("accOpen").value = 1;
  $("accMid").value = 2;
  $("accEnd").value = 3;
}

function init() {
  fillGradeSelectors();

  // Theme engine
  Themes.onChange((theme, mode) => {
    $("themeToggle").textContent = mode === "dark" ? "☀" : "☾";
    $("themeToggle").title = mode === "dark" ? "Switch to light" : "Switch to dark";
  });
  Themes.apply();
  CMT.storage.set("sessions", "themes", Themes.data()); // keep backup mirror fresh
  renderThemeUI();
  $("themeToggle").addEventListener("click", () => { Themes.toggleMode(); renderThemeUI(); });
  $("useSystem").addEventListener("change", () => { Themes.setPrefs({ useSystem: $("useSystem").checked }); renderThemeUI(); });
  $("lightTheme").addEventListener("change", () => Themes.setPrefs({ lightTheme: $("lightTheme").value }));
  $("darkTheme").addEventListener("change", () => Themes.setPrefs({ darkTheme: $("darkTheme").value }));
  $("teSave").addEventListener("click", () => {
    if (!editingTheme) return;
    editingTheme.name = $("teName").value.trim() || editingTheme.name;
    editingTheme.base = $("teBase").value;
    Themes.saveCustom(editingTheme);
    closeThemeEditor();
    renderThemeUI();
  });
  $("teDelete").addEventListener("click", () => {
    if (editingTheme) Themes.deleteCustom(editingTheme.id);
    closeThemeEditor();
    renderThemeUI();
  });
  $("teClose").addEventListener("click", closeThemeEditor);

  // Drawer
  $("openSettings").addEventListener("click", () => setDrawer(true));
  $("closeSettings").addEventListener("click", () => setDrawer(false));
  $("drawerScrim").addEventListener("click", () => setDrawer(false));

  // Core flows
  CMT.loadCustomBook().then(() => { renderCustomBook(); return restoreSession(); });
  $("run").addEventListener("click", () => run(null));
  $("heroRun") && $("heroRun").addEventListener("click", () => run(null));
  $("stop").addEventListener("click", () => { control.stop = true; onStatus("Stopping after current move…"); });

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
  $("lineInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("addLine").click(); } });

  $("clearCache").addEventListener("click", async () => {
    await CMT.clearCaches(engine);
    CMT.storage.set("sessions", "themes", Themes.data()); // themes survive too
    onStatus("Cleared saved evals and results (custom lines and themes kept).");
  });

  $("pgnFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
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
    setDrawer(false);
    run(games);
  });

  $("exportBtn").addEventListener("click", async () => {
    if (!lastResults) return;
    onStatus("Exporting backup…");
    await CMT.storage.set("sessions", "themes", Themes.data());
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
      if (data.themes) { Themes.importData(data.themes); renderThemeUI(); }
      $("exportBtn").disabled = false;
      renderCustomBook();
      renderList();
      onStatus(`Loaded ${summary.positions} positions`
        + (summary.evals ? ` + ${summary.evals} cached evals` : "")
        + (summary.customGroups ? ` + ${summary.customGroups} line group(s)` : "")
        + (summary.themes ? " + themes" : "")
        + " from file.");
    } catch (err) { onStatus("Could not read backup: " + err.message); }
  });

  // Mobile back navigation
  window.addEventListener("popstate", () => { closeTrainer(); });

  // Keyboard
  document.addEventListener("keydown", onKeydown);

  // Persist queued eval writes when the tab closes.
  window.addEventListener("pagehide", () => { CMT.storage.flush(); });
}

document.addEventListener("DOMContentLoaded", init);
