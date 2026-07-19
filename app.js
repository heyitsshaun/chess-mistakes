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
let appMode = "rep";       // 'rep' (repertoire, default) | 'legacy' (engine grading)
let lastResults = null;    // legacy-mode results
let lastRep = null;        // repertoire-mode results {userDev, oppDev, counts}
let currentPos = null;
let currentList = [];      // rendered order, for keyboard nav + "Next"
let isRunning = false;
let isImporting = false;
let isBookChecking = false;
let gradingPromise = null;
let interactionVersion = 0;
const control = { stop: false };
let gameIndex = null;          // GameRec[] for the loaded games
let gameById = new Map();      // id → GameRec
let posIndexCache = null;      // lazy posKey index for the explorer
// Background engine grading: one queue, priority for whatever the user opens.
const bg = { running: false, control: { stop: false }, priority: [] };
// When a sub-view (game viewer, games list, explorer) is open it owns the
// keyboard: map of e.key → handler. null = normal list navigation.
let activePanelKeys = null;
const MODE_KEY = "cmt-mode";
const DRILL_PREFS_KEY = "cmt-drill-prefs";
const drillState = {
  active: false,
  complete: false,
  queueKeys: [],
  sourceKeys: [],
  index: 0,
  config: null,
  settings: null,
  acceptByKey: new Map(),
  outcomes: new Map(),
  sessionId: 0,
  historyOwned: false,
  openSetupAfterExit: false,
  exiting: false,
};

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
    windowSize: CMT.clamp(+$("windowSize").value || 5, 1, 15),
  };
}

// ----------------------------- mode -----------------------------
function setMode(mode, opts) {
  appMode = mode === "legacy" ? "legacy" : "rep";
  try { localStorage.setItem(MODE_KEY, appMode); } catch (e) { /* optional */ }
  $("modeRep").classList.toggle("active", appMode === "rep");
  $("modeLegacy").classList.toggle("active", appMode === "legacy");
  document.body.classList.toggle("mode-legacy", appMode === "legacy");
  if (!opts || !opts.silent) {
    if (drillState.active) exitDrillForDataChange();
    stopBackgroundGrading();
    currentPos = null;
    $("detail").innerHTML = '<p class="empty">Select a position to review and retry it.</p>';
    renderList();
    if (ungradedQueue().length) startBackgroundGrading();
  }
}

// Mode-appropriate empty state (also replaces stale cards on mode switch).
function renderHero() {
  const rep = appMode === "rep";
  $("results").innerHTML = `<div class="hero"><div class="hero-board" aria-hidden="true"></div>
    <h2>${rep ? "Find where your games leave your prep" : "Find the moves you keep getting wrong"}</h2>
    <p>${rep
      ? "Pull your games and compare them to your opening courses: see where you break from your lines first, and how you respond when opponents do."
      : "Pull your games, grade every move with Stockfish, and drill the positions where you go wrong most often."}</p>
    <button id="heroRun" class="primary big">Analyze my games</button></div>`;
  $("heroRun").addEventListener("click", () => run(null));
}

// ----------------------------- status / progress -----------------------------
function onStatus(t) { $("status").textContent = t; }
function onProgress(f) { $("barFill").style.width = Math.round(f * 100) + "%"; }
function syncRunDisabled() {
  $("run").disabled = isRunning || isImporting || !!gradingPromise;
}
function setBusy(busy) {
  isRunning = busy;
  syncRunDisabled();
  $("stop").disabled = !busy;
  if ($("openDrill")) refreshDrillAvailability();
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
  if (isImporting) {
    onStatus("Wait for the current import to finish before starting an analysis.");
    return;
  }
  if (gradingPromise) {
    onStatus("Wait for the current move to finish grading before starting a new analysis.");
    return;
  }
  if (drillState.active) exitDrillForDataChange();
  const s = readSettings();
  if (!s.username && !games) { onStatus("Enter a Chess.com username first."); return; }
  control.stop = false;
  setBusy(true);
  onProgress(0);
  try {
    if (!games) {
      onStatus("Fetching games from Chess.com…");
      games = await CMT.fetchGames(s.username, s.lookback, s.maxGames, onStatus);
      if (!games.length) {
        onStatus("No games found in that window. Check the username/lookback, or load a PGN file (Settings → Data).");
        return;
      }
    }
    // Aggregation/classification is engine-free and instant. Render right
    // away; engine grading fills in as a background pass.
    stopBackgroundGrading();
    setGameIndex(CMT.buildGameIndex(games, s.username));
    if (appMode === "rep") {
      lastRep = CMT.classifyRepertoire(games, s);
      const c = lastRep.counts;
      onStatus(`${c.games} games: you deviated first in ${c.userDev}, opponents in ${c.oppDev}; `
        + `${c.bookEnd} stayed in book, ${c.unmatched} unmatched.`);
    } else {
      lastResults = CMT.aggregatePositions(games, s);
      onStatus(`${games.length} games → ${lastResults.length} unique positions. Grading in background…`);
    }
    onProgress(1);
    saveCurrentSession();
    $("exportBtn").disabled = false;
    renderList();
    startBackgroundGrading();
  } catch (e) {
    console.error(e);
    if (/Failed to fetch|NetworkError|CORS/i.test(e.message)) {
      onStatus("Couldn't reach Chess.com (network/CORS). Load a PGN file instead — Settings → Data.");
    } else {
      onStatus("Error: " + e.message);
    }
    if (lastResults || lastRep) renderList();
  } finally {
    setBusy(false);
  }
}

function saveCurrentSession() {
  // Strip the game viewer's replay caches (_fens/_sans) before persisting.
  const cleanIndex = (gameIndex || []).map((g) => {
    const { _fens, _sans, ...rest } = g;
    return rest;
  });
  CMT.saveSession($("username").value.trim(), lastResults || [], {
    rep: lastRep, mode: appMode, gameIndex: cleanIndex,
  });
}

function setGameIndex(gi) {
  gameIndex = gi || null;
  gameById = new Map((gi || []).map((g) => [g.id, g]));
  posIndexCache = null;
}

function getPosIndex() {
  if (!posIndexCache && gameIndex && gameIndex.length) {
    posIndexCache = CMT.buildPosIndex(gameIndex, 60);
  }
  return posIndexCache;
}

// ----------------------------- background grading -----------------------------
function ungradedQueue() {
  if (appMode === "rep") {
    return lastRep ? CMT.repWindowPositions(lastRep).filter((p) => !p.graded) : [];
  }
  if (!lastResults) return [];
  return CMT.sortResults(lastResults.filter((r) => !r.graded), "occ");
}

function stopBackgroundGrading() {
  bg.control.stop = true;
  bg.priority = [];
}

async function startBackgroundGrading() {
  if (bg.running) return;
  if (!ungradedQueue().length && !bg.priority.length) { onBgDone(); return; }
  const myControl = { stop: false };
  bg.control = myControl;
  bg.running = true;
  const modeAtStart = appMode;
  try {
    await ensureEngine();
    const s = readSettings();
    let renderTimer = null;
    const deps = {
      engine, control: myControl,
      onStatus: (t) => onStatus(t),
      onPosition: (r) => {
        if (currentPos && currentPos.key === r.key && !drillState.active && !gradingPromise) refreshCurrentDetail();
        if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; if (!drillState.active) renderList(); }, 1500);
      },
    };
    let graded = 0;
    while (!myControl.stop && appMode === modeAtStart) {
      const r = bg.priority.shift() || ungradedQueue()[0];
      if (!r) break;
      await CMT.gradePositions([r], s, deps);
      if (r.graded && r.kind === "opp-window") r.answerUcis = r.best ? [r.best] : [];
      graded++;
      if (graded % 10 === 0) saveCurrentSession();
      onProgress(1 - ungradedQueue().length / Math.max(1, graded + ungradedQueue().length));
    }
    saveCurrentSession();
    if (!myControl.stop) onBgDone();
  } catch (e) {
    onStatus("Background grading stopped: " + e.message);
  } finally {
    bg.running = false;
    if (!drillState.active) renderList();
    refreshDrillAvailability();
  }
}

function onBgDone() {
  onProgress(1);
  if (appMode === "rep" && lastRep) {
    if (!ungradedQueue().length && CMT.repWindowPositions(lastRep).length) {
      onStatus("All post-deviation replies graded.");
    }
  } else if (appMode === "legacy" && lastResults) {
    onStatus("All " + lastResults.length + " positions graded.");
  }
  // Legacy mode: book annotation after grading, as before.
  if (appMode === "legacy" && lastResults) {
    const s = readSettings();
    if (s.bookMax > 0 && lastResults.some((r) => r.moveNo <= s.bookMax && !r.bookKnown)) {
      isBookChecking = true;
      CMT.annotateBook(lastResults, s, { onStatus, control: bg.control })
        .then(() => { saveCurrentSession(); onStatus("Opening-book check complete."); })
        .catch((e) => onStatus("Opening-book check could not finish: " + e.message))
        .then(() => { isBookChecking = false; if (!drillState.active) renderList(); });
    }
  }
}

// Re-render whatever detail panel is currently open (after its grade arrives).
function refreshCurrentDetail() {
  const r = currentPos;
  if (!r) return;
  const el = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === (r.groupKey || r.key));
  if (r.kind === "opp-window") selectOppWindow(r);
  else selectPosition(r, el || null);
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
  const u = typeof Pieces !== "undefined" && Pieces.url(pc);
  if (u) return `<img class="piece" src="${u}" alt="" draggable="false" />`;
  return `<svg class="piece" viewBox="0 0 45 45" aria-hidden="true">${pieceInner(pc)}</svg>`;
}

// ----------------------------- results list -----------------------------
const miniBoardCache = new Map();
function miniBoardSVG(fen, orient) {
  const setId = typeof Pieces !== "undefined" ? Pieces.id() : "classic";
  const ck = setId + "|" + orient + "|" + fen;
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
      if (pc) {
        const u = typeof Pieces !== "undefined" && Pieces.url(pc);
        cells += u
          ? `<image x="${x}" y="${y}" width="10" height="10" href="${u}"/>`
          : `<svg x="${x}" y="${y}" width="10" height="10" viewBox="0 0 45 45">${pieceInner(pc)}</svg>`;
      }
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
  let h = level == null
    ? '<span class="pill Pending" title="Engine grade pending">…</span>'
    : `<span class="pill ${LEVELS[level]}">${LEVELS[level]}</span>`;
  if (isBook) h += ' <span class="pill Book">Book</span>';
  if (isIgnored) h += ' <span class="pill Ignored">Ignored</span>';
  return h;
}

function renderList() {
  if (appMode === "rep") { renderRepList(); return; }
  if (!lastResults) {
    currentList = [];
    renderHero();
    refreshDrillAvailability();
    return;
  }
  const showAll = $("showAll").checked;
  const hideBefore = +$("hideBefore").value || 0;
  CMT.recomputeFlags(lastResults, readSettings(), $("ignoreBook").checked, CMT.customBook.set);
  let list = lastResults.filter((r) => (showAll || r.flagged) && r.moveNo > hideBefore);
  list = CMT.sortResults(list, $("sortBy").value);
  currentList = list;
  refreshDrillAvailability();
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
        <div class="meta">bad ${(r.badShare * 100).toFixed(0)}% · score ${winCellHtml(positionGameIds(r))} · ${r.graded ? `avg loss ${r.avgCpl.toFixed(0)}cp · best <b>${CMT.escapeHtml(CMT.uciToSan(r.fen, r.best) || r.best || "?")}</b>` : '<span class="hint">grading…</span>'}</div>
      </div>
      <span class="chev">›</span>`;
    card.addEventListener("click", () => selectPosition(r, card));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPosition(r, card); } });
    el.appendChild(card);
  }
}

// Union of a position's plays' game ids (for card-level win %).
function positionGameIds(r) {
  const ids = [];
  for (const p of r.plays || []) for (const id of p.gameIds || []) ids.push(id);
  return ids;
}

// Compact insight strip at the top of the repertoire list.
function repSummaryHtml() {
  if (!lastRep || !lastRep.counts) return "";
  const c = lastRep.counts;
  const matched = c.games - c.unmatched;
  const inBookPct = matched ? Math.round((c.bookEnd / matched) * 100) : 0;
  const allIds = gameIndex ? gameIndex.map((g) => g.id) : [];
  const overall = allIds.length ? CMT.scoreStats(allIds, gameById) : null;
  const topLeak = lastRep.userDev.slice().sort((a, b) => b.badCount - a.badCount)[0];
  return `<div class="rep-summary">
    <span><b>${c.games}</b> games</span>
    <span><b>${inBookPct}%</b> stayed in book</span>
    <span class="s-user"><b>${c.userDev}</b> you left first</span>
    <span class="s-opp"><b>${c.oppDev}</b> they left first</span>
    ${overall && overall.n ? `<span>score <b>${overall.pct}%</b></span>` : ""}
    ${topLeak ? `<span class="s-leak" title="${CMT.escapeHtml(topLeak.opening || "")}">worst leak: <b>${CMT.escapeHtml(topLeak.plays[0].san)}</b> ×${topLeak.badCount} (move ${topLeak.moveNo})</span>` : ""}
  </div>`;
}

// Repertoire-mode list: user-dev and opp-dev cards, filterable, same rail.
function expectedSans(r) {
  return (r.expected || []).map((e) => CMT.escapeHtml(e.san)).join(" or ");
}
function courseTag(r) {
  const warn = r.multiCourse ? ' <span class="pill Multi" title="Position appears in more than one course">⚠ multi</span>' : "";
  return `<span class="opening">${CMT.escapeHtml(r.courseName || "Course")}</span>${warn}`;
}

function renderRepList() {
  if (!lastRep) {
    currentList = [];
    renderHero();
    refreshDrillAvailability();
    return;
  }
  const showAll = $("showAll").checked;
  const hideBefore = +$("hideBefore").value || 0;
  const s = readSettings();
  CMT.recomputeRepertoireFlags(lastRep, s, CMT.customBook.set);
  let items = CMT.repertoireItems(lastRep, $("devFilter").value);
  items = items.filter((r) => (showAll || r.flagged) && r.moveNo > hideBefore);
  items = CMT.sortResults(items, $("sortBy").value);
  currentList = items;
  refreshDrillAvailability();
  const el = $("results");
  if (!items.length) {
    const any = lastRep.userDev.length + lastRep.oppDev.length;
    el.innerHTML = `<div class="hero"><div class="hero-board" aria-hidden="true"></div>
      <h2>${any ? "Nothing flagged with these filters" : "No deviations found"}</h2>
      <p>${any
        ? "Deviations exist but none match the current filters — try “show all”, lower the thresholds, or switch the deviation filter."
        : "Every analyzed game either stayed inside your courses or wasn't matched. Widen the lookback or check the right courses are loaded (Settings → Repertoire courses)."}</p></div>`;
    return;
  }
  el.innerHTML = repSummaryHtml();
  for (const r of items) {
    const card = document.createElement("div");
    card.className = "card" + (currentPos && currentPos.key === r.key ? " active" : "");
    card.dataset.key = r.key;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    if (r.kind === "user-dev") {
      const worst = r.plays[0];
      card.innerHTML = `
        <div class="thumb">${miniBoardSVG(r.fen, r.color)}</div>
        <div>
          ${courseTag(r)} <span class="meta">Move ${r.moveNo} · ${r.color === "w" ? "White" : "Black"}</span>
          <div class="line"><span class="pill UserDev">I deviated</span> You played <b>${CMT.escapeHtml(worst.san)}</b> ${worst.count}/${r.total}×</div>
          <div class="sevbar"><span style="width:${Math.round(r.badShare * 100)}%;background:var(--mistake)"></span></div>
          <div class="meta">off-book ${(r.badShare * 100).toFixed(0)}% of ${r.total} visit${r.total === 1 ? "" : "s"} · score ${winCellHtml(positionGameIds(r))} · course: <b>${expectedSans(r)}</b></div>
        </div>
        <span class="chev">›</span>`;
    } else {
      const graded = r.positions.reduce((n, p) => n + p.total, 0);
      const bad = r.badCount;
      card.innerHTML = `
        <div class="thumb">${miniBoardSVG(r.fen, r.color)}</div>
        <div>
          ${courseTag(r)} <span class="meta">Move ${r.moveNo} · ${r.color === "w" ? "White" : "Black"} to answer</span>
          <div class="line"><span class="pill OppDev">They deviated</span> Opponents played <b>${CMT.escapeHtml(r.theirMove.san)}</b> ${r.count}×</div>
          <div class="sevbar"><span style="width:${Math.round(r.badShare * 100)}%;background:var(--inacc)"></span></div>
          <div class="meta">${bad ? `<b>${bad}</b> of your ${graded} replies flagged` : graded ? `all ${graded} of your replies fine` : "replies not graded yet"} · score ${winCellHtml(r.gameIds)} · avg loss ${r.avgCpl.toFixed(0)}cp</div>
        </div>
        <span class="chev">›</span>`;
    }
    card.addEventListener("click", () => selectPosition(r, card));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPosition(r, card); } });
    el.appendChild(card);
  }
}

// ----------------------------- shuffled drill -----------------------------
function normalizeDrillConfig(raw) {
  raw = raw || {};
  const minOccurrences = Math.max(1, Math.ceil(Number(raw.minOccurrences) || 1));
  const rate = Number(raw.minMistakeShare);
  const minMistakeShare = CMT.clamp(Number.isFinite(rate) ? rate : 0.5, 0, 1);
  const parsedLimit = Number(raw.limit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : null;
  return {
    minOccurrences,
    minMistakeShare,
    skipFirst: Math.max(0, Math.floor(Number(raw.skipFirst) || 0)),
    limit,
  };
}

function currentDrillConfig() {
  const s = readSettings();
  return normalizeDrillConfig({
    minOccurrences: s.minOcc,
    minMistakeShare: s.flagShare,
    skipFirst: +$("hideBefore").value || 0,
    limit: null,
  });
}

function setupDrillConfig() {
  return normalizeDrillConfig({
    minOccurrences: $("drillMinOcc").value,
    minMistakeShare: (+$("drillMinRate").value || 0) / 100,
    skipFirst: +$("hideBefore").value || 0,
    limit: $("drillLimit").value === "all" ? null : +$("drillLimit").value,
  });
}

function computeDrillPool(config) {
  if (appMode === "rep") {
    if (!lastRep) return [];
    CMT.recomputeRepertoireFlags(lastRep, readSettings(), CMT.customBook.set);
    const include = { all: "all", user: "user", opp: "opp" }[$("devFilter").value] || "all";
    return CMT.repertoireDrillPool(lastRep, Object.assign({}, config, { include }))
      .filter((r) => r.fen && (r.kind === "user-dev" ? r.answerUcis.length : r.best));
  }
  if (!lastResults || !lastResults.length) return [];
  CMT.recomputeFlags(lastResults, readSettings(), $("ignoreBook").checked, CMT.customBook.set);
  return CMT.filterDrillPositions(lastResults, config)
    .filter((r) => r.fen && r.best);
}

function hasAnyResults() {
  return appMode === "rep"
    ? !!lastRep && (lastRep.userDev.length + lastRep.oppDev.length) > 0
    : !!lastResults && lastResults.length > 0;
}

function refreshDrillAvailability() {
  const button = $("openDrill");
  const count = $("drillEligibleCount");
  if (!button || !count) return;
  const pool = computeDrillPool(currentDrillConfig());
  button.disabled = !hasAnyResults() || isRunning || isImporting || isBookChecking || !!gradingPromise;
  count.textContent = isBookChecking ? "Checking book…" : hasAnyResults() ? `${pool.length} eligible` : "Analyze first";
  if (!$("drillSetup").hidden) updateDrillPoolPreview();
}

function updateDrillPoolPreview() {
  const config = setupDrillConfig();
  const pool = computeDrillPool(config);
  const roundSize = config.limit ? Math.min(config.limit, pool.length) : pool.length;
  const preview = $("drillPoolPreview");
  const start = $("startDrill");
  if (!pool.length) {
    preview.textContent = "No positions match. Lower either threshold to widen the pool.";
    start.disabled = true;
  } else {
    preview.textContent = config.limit && pool.length > roundSize
      ? `${pool.length} match; ${roundSize} will be chosen randomly for this round.`
      : `${roundSize} position${roundSize === 1 ? "" : "s"} will appear once in this round.`;
    start.disabled = false;
  }
}

function loadDrillPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRILL_PREFS_KEY));
    if (!saved) return;
    const config = normalizeDrillConfig(saved);
    $("minOcc").value = config.minOccurrences;
    $("flagShare").value = config.minMistakeShare;
    $("drillLimit").value = config.limit == null ? "all" : String(config.limit);
  } catch (e) { /* ignore malformed local preferences */ }
}

function saveDrillPrefs(config) {
  try {
    localStorage.setItem(DRILL_PREFS_KEY, JSON.stringify({
      minOccurrences: config.minOccurrences,
      minMistakeShare: config.minMistakeShare,
      limit: config.limit,
    }));
  } catch (e) { /* preferences are optional */ }
}

function openDrillSetup() {
  if (isBookChecking) {
    onStatus("Wait for the opening-book check to finish before starting a drill.");
    return;
  }
  if (!hasAnyResults()) {
    onStatus("Analyze some games before starting a drill.");
    return;
  }
  const s = readSettings();
  $("drillMinOcc").value = s.minOcc;
  $("drillMinRate").value = Math.round(s.flagShare * 100);
  $("drillSetup").hidden = false;
  updateDrillPoolPreview();
  $("drillMinOcc").focus();
}

function closeDrillSetup() {
  $("drillSetup").hidden = true;
}

function copySettingsForDrill() {
  const s = readSettings();
  return Object.assign({}, s, {
    th: Object.assign({}, s.th),
    phases: Object.assign({}, s.phases),
  });
}

function positionForDrillKey(key) {
  if (appMode === "rep") {
    if (!lastRep) return null;
    const ud = lastRep.userDev.find((r) => r.key === key);
    if (ud) return ud;
    for (const g of lastRep.oppDev) {
      const p = g.positions.find((q) => q.key === key);
      if (p) return p;
    }
    return null;
  }
  return (lastResults || []).find((r) => r.key === key) || null;
}

function setDrillHistoryState() {
  if (!MOBILE() || drillState.historyOwned) return;
  history.pushState({ trainer: 1, drill: drillState.sessionId }, "");
  drillState.historyOwned = true;
}

function beginDrillRound(sourcePositions, config, preserveHistory) {
  const shuffled = CMT.shuffleCopy(sourcePositions);
  const chosen = config.limit ? shuffled.slice(0, config.limit) : shuffled;
  if (!chosen.length) return false;

  interactionVersion++;
  drillState.active = true;
  drillState.complete = false;
  drillState.queueKeys = chosen.map((r) => r.key);
  drillState.sourceKeys = sourcePositions.map((r) => r.key);
  drillState.index = 0;
  drillState.config = Object.assign({}, config);
  drillState.settings = copySettingsForDrill();
  drillState.acceptByKey = new Map(sourcePositions.map((r) => [r.key, r.accept]));
  drillState.outcomes = new Map();
  drillState.navigating = false;
  drillState.sessionId++;
  drillState.openSetupAfterExit = false;
  drillState.exiting = false;

  document.body.classList.add("drill-active");
  closeDrillSetup();
  if (!preserveHistory) setDrillHistoryState();
  else if (drillState.historyOwned && history.state && history.state.drill) {
    history.replaceState({ trainer: 1, drill: drillState.sessionId }, "");
  }
  showDrillPosition();
  return true;
}

function startDrill() {
  if (gradingPromise || isRunning || isImporting || isBookChecking) return;
  const config = setupDrillConfig();
  const pool = computeDrillPool(config);
  if (!pool.length) {
    updateDrillPoolPreview();
    return;
  }

  // These are the same eligibility controls used by the normal mistake list.
  $("minOcc").value = config.minOccurrences;
  $("flagShare").value = config.minMistakeShare;
  saveDrillPrefs(config);
  renderList();
  beginDrillRound(pool, config, false);
}

function drillOutcome(key) {
  let outcome = drillState.outcomes.get(key);
  if (!outcome) {
    outcome = { attempts: 0, firstTry: null, solved: false, revealed: false, skipped: false };
    drillState.outcomes.set(key, outcome);
  }
  return outcome;
}

function syncDrillControls() {
  if (!drillState.active || drillState.complete || !currentPos) return;
  const outcome = drillOutcome(currentPos.key);
  const pending = !!gradingPromise || isImporting || boardState.locked;
  const reveal = $("drillReveal");
  const reset = $("drillReset");
  const next = $("drillNext");
  if (reveal) {
    reveal.disabled = pending || outcome.revealed || outcome.solved;
    reveal.textContent = outcome.revealed ? "Answer revealed" : outcome.solved ? "Solved" : "Reveal answer";
  }
  if (reset) reset.disabled = pending;
  if (next) {
    next.disabled = pending;
    const last = drillState.index >= drillState.queueKeys.length - 1;
    const resolved = outcome.solved || outcome.revealed;
    next.textContent = last ? "Finish" : resolved ? "Next →" : "Skip →";
  }
}

function showDrillPosition() {
  if (!drillState.active) return;
  let r = positionForDrillKey(drillState.queueKeys[drillState.index]);
  while (!r && drillState.index < drillState.queueKeys.length - 1) {
    drillState.index++;
    r = positionForDrillKey(drillState.queueKeys[drillState.index]);
  }
  if (!r) {
    finishDrill();
    return;
  }

  interactionVersion++;
  activePanelKeys = null;
  currentPos = r;
  boardState.chess = new Chess(r.fen);
  boardState.orient = r.color;
  boardState.sel = null;
  boardState.best = null;
  boardState.locked = false;
  boardState.onMove = retryMove;
  drillState.navigating = false;

  const positionNumber = drillState.index + 1;
  const total = drillState.queueKeys.length;
  const progress = Math.round((drillState.index / total) * 100);
  $("detail").innerHTML = `
    <div class="drill-shell">
      <div class="drill-header">
        <div class="drill-header-copy">
          <div class="drill-kicker">Shuffle drill</div>
          <h2>Position ${positionNumber} of ${total}</h2>
          <div class="drill-position-meta">${r.color === "w" ? "White" : "Black"} to move</div>
        </div>
        <button id="exitDrill" type="button">End drill</button>
      </div>
      <div class="drill-progress" aria-label="${drillState.index} of ${total} positions completed">
        <div class="drill-progress-meta"><span>${drillState.index} completed</span><span>${total - drillState.index} remaining</span></div>
        <div class="drill-progress-track"><span class="drill-progress-fill" style="width:${progress}%"></span></div>
      </div>
      <div class="board-wrap">
        <div id="board" class="board" tabindex="0" aria-label="Chess position for drill ${positionNumber}"></div>
        <div id="feedback" class="feedback" aria-live="polite">${r.kind === "user-dev"
          ? "Your move. Play what your course plays here."
          : "Your move. Play a move that avoids the mistake."}</div>
      </div>
      <div class="drill-actions">
        <button id="drillReveal" type="button">Reveal answer</button>
        <button id="drillReset" type="button">Reset</button>
        <button id="drillNext" class="next" type="button">Skip →</button>
      </div>
    </div>`;

  renderBoard();
  $("exitDrill").addEventListener("click", () => requestExitDrill(false));
  $("drillReveal").addEventListener("click", revealDrillAnswer);
  $("drillReset").addEventListener("click", resetCurrent);
  $("drillNext").addEventListener("click", advanceDrill);
  syncDrillControls();
  requestAnimationFrame(() => $("board") && $("board").focus && $("board").focus());
}

function revealDrillAnswer() {
  if (!drillState.active || drillState.complete || !currentPos || gradingPromise) return;
  const outcome = drillOutcome(currentPos.key);
  if (outcome.solved) return;
  outcome.revealed = true;
  const fb = $("feedback");
  fb.className = "feedback";
  if (currentPos.kind === "user-dev") {
    boardState.best = currentPos.answerUcis[0];
    drawArrow();
    fb.innerHTML = `Course move: <b>${expectedSans(currentPos)}</b>. You can try it, then continue.`;
  } else {
    boardState.best = currentPos.best;
    drawArrow();
    const bestSan = CMT.uciToSan(currentPos.fen, currentPos.best) || currentPos.best || "?";
    fb.innerHTML = `Best move: <b>${CMT.escapeHtml(bestSan)}</b>. You can try it, then continue.`;
  }
  syncDrillControls();
}

function advanceDrill() {
  if (!drillState.active || drillState.complete || gradingPromise || drillState.navigating) return;
  drillState.navigating = true;
  interactionVersion++;
  const outcome = currentPos ? drillOutcome(currentPos.key) : null;
  if (outcome && !outcome.solved && !outcome.revealed) outcome.skipped = true;
  if (drillState.index >= drillState.queueKeys.length - 1) {
    finishDrill();
    return;
  }
  drillState.index++;
  showDrillPosition();
}

function finishDrill() {
  if (!drillState.active) return;
  interactionVersion++;
  drillState.complete = true;
  drillState.navigating = false;
  currentPos = null;
  boardState.chess = null;
  boardState.best = null;
  boardState.locked = false;

  const outcomes = drillState.queueKeys.map((key) => drillOutcome(key));
  const firstTry = outcomes.filter((o) => o.firstTry === true && !o.revealed).length;
  const recovered = outcomes.filter((o) => o.solved && o.firstTry !== true && !o.revealed).length;
  const assisted = outcomes.filter((o) => o.revealed || o.skipped).length;
  $("detail").innerHTML = `
    <div class="drill-shell">
      <section class="drill-summary" aria-live="polite">
        <div class="drill-kicker">Round complete</div>
        <h2>You finished ${drillState.queueKeys.length} position${drillState.queueKeys.length === 1 ? "" : "s"}</h2>
        <p>Run the same pool again to get a fresh order, or adjust the thresholds before the next round.</p>
        <div class="drill-summary-grid">
          <div class="drill-summary-stat"><span class="drill-summary-value">${firstTry}</span><span class="drill-summary-label">First try</span></div>
          <div class="drill-summary-stat"><span class="drill-summary-value">${recovered}</span><span class="drill-summary-label">Recovered</span></div>
          <div class="drill-summary-stat"><span class="drill-summary-value">${assisted}</span><span class="drill-summary-label">Revealed / skipped</span></div>
        </div>
        <div class="btnrow">
          <button id="exitDrillSummary" type="button">Back to positions</button>
          <button id="adjustDrill" type="button">Adjust filters</button>
          <button id="reshuffleDrill" class="primary" type="button">Shuffle again</button>
        </div>
      </section>
    </div>`;
  $("exitDrillSummary").addEventListener("click", () => requestExitDrill(false));
  $("adjustDrill").addEventListener("click", () => requestExitDrill(true));
  $("reshuffleDrill").addEventListener("click", reshuffleDrill);
}

function reshuffleDrill() {
  if (!drillState.active || gradingPromise) return;
  const source = drillState.sourceKeys.map(positionForDrillKey).filter(Boolean);
  if (!source.length) {
    requestExitDrill(true);
    return;
  }
  beginDrillRound(source, drillState.config, true);
}

function requestExitDrill(openSetup) {
  if (!drillState.active || drillState.exiting) return;
  drillState.exiting = true;
  drillState.openSetupAfterExit = !!openSetup;
  if (drillState.historyOwned && history.state && history.state.drill) {
    history.back();
  } else {
    exitDrillNow();
  }
}

function exitDrillNow() {
  if (!drillState.active) return;
  const openSetup = drillState.openSetupAfterExit;
  interactionVersion++;
  document.body.classList.remove("drill-active");
  document.body.classList.remove("trainer-open");
  drillState.active = false;
  drillState.complete = false;
  drillState.queueKeys = [];
  drillState.sourceKeys = [];
  drillState.index = 0;
  drillState.settings = null;
  drillState.acceptByKey = new Map();
  drillState.outcomes = new Map();
  drillState.historyOwned = false;
  drillState.openSetupAfterExit = false;
  drillState.navigating = false;
  drillState.exiting = false;
  currentPos = null;
  activePanelKeys = null;
  boardState.chess = null;
  boardState.best = null;
  boardState.locked = false;
  $("detail").innerHTML = '<p class="empty">Select a position to review and retry it.</p>';
  renderList();
  if (openSetup) openDrillSetup();
}

function exitDrillForDataChange() {
  if (!drillState.active) return;
  if (drillState.historyOwned && history.state && history.state.drill) history.back();
  exitDrillNow();
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
function requestCloseTrainer() {
  if (MOBILE() && history.state && history.state.trainer) history.back();
  else closeTrainer();
}

function selectPosition(r, cardEl) {
  if (drillState.active) return;
  if (gradingPromise) {
    onStatus("Wait for the current move to finish grading before changing positions.");
    return;
  }
  requestPriorityGrade(r);
  if (r.kind === "user-dev") return selectUserDev(r, cardEl);
  if (r.kind === "opp-dev") return selectOppDev(r, cardEl);
  if (r.kind === "opp-window") return selectOppWindow(r);
  interactionVersion++;
  activePanelKeys = null;
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
      <td>${winCellHtml(p.gameIds)}</td>
      <td>${pills(p.level, p.book, ig)}</td>
      <td class="evalnum">${p.level == null ? "…" : (p.cplSum / p.count).toFixed(0) + "cp"}</td>
      <td class="rowbtns"><button class="igbtn gbtn" data-uci="${p.uci}">games</button>
        <button class="igbtn" data-uci="${p.uci}" data-san="${CMT.escapeHtml(p.san)}">${ig ? "unignore" : "ignore"}</button></td></tr>`;
  }).join("");

  const idx = currentList.indexOf(r);
  const hasNext = idx >= 0 && idx < currentList.length - 1;

  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="backBtn" aria-label="Back to list">←</button>
      <div>
        <h2>${r.opening ? CMT.escapeHtml(r.opening) + " · " : ""}Move ${r.moveNo}</h2>
        <div class="statline">${r.phase} · ${r.color === "w" ? "White" : "Black"} to move · seen ${r.total}× · bad <span id="badPct">0%</span>${r.graded ? "" : ' · <span class="hint">grading…</span>'}</div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div id="feedback" class="feedback" aria-live="polite">Your move. Play the move you think is best.</div>
      <div class="btnrow mobile-actions">
        <button id="showBest" ${r.best ? "" : "disabled"}>Show best</button>
        <button id="resetBoard">Reset</button>
        <button id="nextPos" class="next" ${hasNext ? "" : "disabled"}>Next →</button>
      </div>
    </div>
    <table class="hist">
      <thead><tr><th>Your moves here</th><th>#</th><th>Win</th><th>Grade</th><th>Avg loss</th><th></th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;

  renderBoard();
  countUp($("badPct"), Math.round(r.badShare * 100), "%");

  $("backBtn").addEventListener("click", () => {
    requestCloseTrainer();
  });
  const reopen = () => {
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === r.key);
    selectPosition(r, el2 || null);
  };
  document.querySelectorAll(".igbtn:not(.gbtn)").forEach((b) => b.addEventListener("click", () => {
    CMT.toggleManualIgnore(r, b.dataset.uci, b.dataset.san);
    renderCustomBook();
    renderList();
    reopen();
  }));
  wireGamesButtons(r, reopen);
  $("showBest").addEventListener("click", () => {
    if (gradingPromise || !r.best) return;
    boardState.best = r.best;
    drawArrow();
    const bestSan = CMT.uciToSan(r.fen, r.best) || r.best || "?";
    const fb = $("feedback");
    fb.className = "feedback";
    fb.innerHTML = `Engine's best: <b>${CMT.escapeHtml(bestSan)}</b> (eval ${CMT.fmtEval(r.bestEval)}).`;
  });
  $("resetBoard").addEventListener("click", resetCurrent);
  $("nextPos").addEventListener("click", () => {
    if (gradingPromise) return;
    const i = currentListIndex();
    const next = i >= 0 ? currentList[i + 1] : null;
    if (!next) return;
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === next.key);
    selectPosition(next, el2 || null);
    if (el2 && !MOBILE()) el2.scrollIntoView({ block: "nearest" });
  });

  openTrainer();
}

// ----------------------------- games drill-down -----------------------------
function winCellHtml(gameIds) {
  if (!gameIds || !gameIds.length || !gameById.size) return '<span class="hint">–</span>';
  const st = CMT.scoreStats(gameIds, gameById);
  if (!st.n) return '<span class="hint">–</span>';
  const cls = st.pct >= 55 ? "wgood" : st.pct <= 45 ? "wbad" : "";
  return `<span class="win ${cls}" title="${st.w}W ${st.d}D ${st.l}L">${st.pct}%</span>`;
}

function resultBadge(g) {
  const r = g.score === 1 ? "W" : g.score === 0 ? "L" : g.score === 0.5 ? "D" : "?";
  return `<span class="resbadge res${r}">${r}</span>`;
}

// List of games (from ids) rendered into the detail panel. `back` restores
// the previous panel.
function openGamesList(opts) {
  const ids = (opts.gameIds || []).filter((id) => gameById.has(id));
  const st = CMT.scoreStats(ids, gameById);
  const rows = ids.map((id) => {
    const g = gameById.get(id);
    const opp = g.userColor === "w" ? g.black : g.white;
    return `<tr class="grow" data-id="${id}" role="button" tabindex="0">
      <td>${resultBadge(g)}</td>
      <td><b>${CMT.escapeHtml(opp || "?")}</b><span class="hint"> · ${g.userColor === "w" ? "White" : "Black"}</span></td>
      <td class="hint">${CMT.escapeHtml(g.date || "")}</td>
      <td>${g.url ? `<a href="${g.url}" target="_blank" rel="noopener" class="hint" onclick="event.stopPropagation()">↗</a>` : ""}</td>
    </tr>`;
  }).join("");
  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="glBack" aria-label="Back">←</button>
      <div>
        <h2>${opts.title || "Games"}</h2>
        <div class="statline">${ids.length} game${ids.length === 1 ? "" : "s"}${st.n ? ` · score ${st.pct}% (${st.w}W ${st.d}D ${st.l}L)` : ""}</div>
      </div>
    </div>
    ${ids.length ? `<table class="hist games">
      <thead><tr><th></th><th>Opponent</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p class="hint">No games on record for this move (imported results without game data?).</p>'}
    <p class="hint">Click a game to step through its moves.</p>`;
  activePanelKeys = { Escape: opts.back };
  $("glBack").addEventListener("click", opts.back);
  document.querySelectorAll(".grow").forEach((row) => {
    const open = () => {
      const g = gameById.get(row.dataset.id);
      const jump = opts.jumpKey && g ? plyOfPosition(g, opts.jumpKey) : undefined;
      openGameViewer(row.dataset.id, () => openGamesList(opts), jump);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  openTrainer();
}

// Step-through viewer for one game. `back` restores the games list (or
// whatever opened it). jumpPly (optional) starts at that half-move.
function openGameViewer(gameId, back, jumpPly) {
  const g = gameById.get(gameId);
  if (!g) return;
  if (!g._fens) { // replay once, cache positions
    const c = new Chess();
    g._fens = [c.fen()];
    g._sans = [];
    for (const san of g.sans) {
      let mv; try { mv = c.move(san, { sloppy: true }); } catch (e) { break; }
      if (!mv) break;
      g._sans.push(mv.san);
      g._fens.push(c.fen());
    }
  }
  let ply = Math.min(Math.max(0, jumpPly != null ? jumpPly : 0), g._sans.length);
  const opp = g.userColor === "w" ? g.black : g.white;
  interactionVersion++;
  currentPos = null;

  const movesHtml = g._sans.map((san, i) =>
    `${i % 2 === 0 ? `<span class="mvno">${i / 2 + 1}.</span>` : ""}<button class="mv" data-ply="${i + 1}">${CMT.escapeHtml(san)}</button>`
  ).join(" ");
  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="gvBack" aria-label="Back">←</button>
      <div>
        <h2>${resultBadge(g)} vs ${CMT.escapeHtml(opp || "?")}</h2>
        <div class="statline">${g.userColor === "w" ? "White" : "Black"} · ${CMT.escapeHtml(g.opening || "")}${g.date ? " · " + CMT.escapeHtml(g.date) : ""}
          ${g.url ? ` · <a href="${g.url}" target="_blank" rel="noopener">chess.com ↗</a>` : ""}</div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div class="btnrow mobile-actions">
        <button id="gvStart">⏮</button>
        <button id="gvPrev">←</button>
        <button id="gvNext" class="next">→</button>
        <button id="gvEnd">⏭</button>
      </div>
    </div>
    <div class="gv-moves" id="gvMoves">${movesHtml}</div>`;

  boardState.chess = new Chess(g._fens[ply]);
  boardState.orient = g.userColor || "w";
  boardState.sel = null; boardState.best = null;
  boardState.locked = true; boardState.onMove = null;

  const sync = () => {
    boardState.chess = new Chess(g._fens[ply]);
    boardState.best = null;
    renderBoard();
    document.querySelectorAll("#gvMoves .mv").forEach((b) => b.classList.toggle("cur", +b.dataset.ply === ply));
    const cur = document.querySelector("#gvMoves .mv.cur");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  };
  sync();
  const nav = {
    start: () => { ply = 0; sync(); },
    prev: () => { ply = Math.max(0, ply - 1); sync(); },
    next: () => { ply = Math.min(g._sans.length, ply + 1); sync(); },
    end: () => { ply = g._sans.length; sync(); },
  };
  activePanelKeys = {
    ArrowLeft: nav.prev, ArrowRight: nav.next, ArrowUp: nav.prev, ArrowDown: nav.next,
    Home: nav.start, End: nav.end, Escape: back,
  };
  $("gvBack").addEventListener("click", back);
  $("gvStart").addEventListener("click", nav.start);
  $("gvPrev").addEventListener("click", nav.prev);
  $("gvNext").addEventListener("click", nav.next);
  $("gvEnd").addEventListener("click", nav.end);
  document.querySelectorAll("#gvMoves .mv").forEach((b) =>
    b.addEventListener("click", () => { ply = +b.dataset.ply; sync(); }));
  openTrainer();
}

// Find the ply at which `fen`'s position occurs in a game (for jump-to-move).
function plyOfPosition(g, key) {
  const c = new Chess();
  for (let i = 0; i < g.sans.length; i++) {
    if (CMT.posKey(c.fen()) === key) return i;
    let mv; try { mv = c.move(g.sans[i], { sloppy: true }); } catch (e) { break; }
    if (!mv) break;
  }
  return 0;
}

// Wire every ".gbtn" in the current detail panel to open the games list for
// that play of position `r`; `back` re-renders the panel.
function wireGamesButtons(r, back) {
  document.querySelectorAll(".gbtn").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const play = r.plays.find((p) => p.uci === b.dataset.uci);
    if (!play) return;
    openGamesList({
      title: `Games where you played ${play.san}`,
      gameIds: play.gameIds || [], jumpKey: r.key, back,
    });
  }));
}

// Ask the background grader to do this position next.
function requestPriorityGrade(r) {
  if (!r || r.graded || r.kind === "user-dev") return;
  const targets = r.kind === "opp-dev" ? r.positions.filter((p) => !p.graded) : [r];
  for (const t of targets) if (!bg.priority.includes(t)) bg.priority.unshift(t);
  if (targets.length) startBackgroundGrading();
}

// ---- repertoire detail panels ----
function activateCard(cardEl) {
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("active"));
  if (cardEl) cardEl.classList.add("active");
}

function setupBoardFor(r) {
  interactionVersion++;
  activePanelKeys = null;
  currentPos = r;
  boardState.chess = new Chess(r.fen);
  boardState.orient = r.color;
  boardState.sel = null;
  boardState.best = null;
  boardState.locked = false;
  boardState.onMove = retryMove;
}

function wireDetailCommon(r) {
  const back = $("backBtn");
  if (back) back.addEventListener("click", requestCloseTrainer);
  const toExpl = $("toExplorer");
  if (toExpl) toExpl.addEventListener("click", () => {
    if (gradingPromise) return;
    // Window positions deep-link via their opp-dev group.
    const target = r.kind === "opp-window" && lastRep
      ? lastRep.oppDev.find((g) => g.key === r.groupKey) || r
      : r;
    openInExplorer(target);
  });
  const show = $("showBest");
  if (show) show.addEventListener("click", () => { if (!gradingPromise) showAnswerFor(r); });
  const reset = $("resetBoard");
  if (reset) reset.addEventListener("click", resetCurrent);
  const next = $("nextPos");
  if (next) next.addEventListener("click", () => {
    if (gradingPromise) return;
    const i = currentListIndex();
    const nxt = i >= 0 ? currentList[i + 1] : null;
    if (!nxt) return;
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === nxt.key);
    selectPosition(nxt, el2 || null);
    if (el2 && !MOBILE()) el2.scrollIntoView({ block: "nearest" });
  });
}

// Index of the current position in the rendered list. Key-based because the
// opp-dev panel sets currentPos to an inner window position whose key matches
// the group's card.
function currentListIndex() {
  if (!currentPos) return -1;
  const i = currentList.indexOf(currentPos);
  if (i >= 0) return i;
  const k = currentPos.groupKey || currentPos.key;
  return currentList.findIndex((x) => x.key === k);
}

// "Show answer" for any repertoire position: course move(s) for user-dev,
// engine best for graded window positions.
function showAnswerFor(r) {
  const fb = $("feedback");
  if (r.kind === "user-dev") {
    boardState.best = r.answerUcis[0];
    drawArrow();
    fb.className = "feedback";
    fb.innerHTML = `Course plays <b>${expectedSans(r)}</b> here.`;
  } else if (r.best) {
    boardState.best = r.best;
    drawArrow();
    const bestSan = CMT.uciToSan(r.fen, r.best) || r.best || "?";
    fb.className = "feedback";
    fb.innerHTML = `Engine's best: <b>${CMT.escapeHtml(bestSan)}</b> (eval ${CMT.fmtEval(r.bestEval)}).`;
  }
}

function selectUserDev(r, cardEl) {
  activateCard(cardEl);
  setupBoardFor(r);
  const histRows = r.plays.map((p) => `
    <tr><td><b>${CMT.escapeHtml(p.san)}</b></td><td>${p.count}</td>
    <td>${winCellHtml(p.gameIds)}</td>
    <td><span class="pill OffBook">Off-book</span></td>
    <td class="rowbtns"><button class="igbtn gbtn" data-uci="${p.uci}">games</button></td></tr>`).join("");
  const idx = currentList.indexOf(r);
  const hasNext = idx >= 0 && idx < currentList.length - 1;
  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="backBtn" aria-label="Back to list">←</button>
      <div>
        <h2>${CMT.escapeHtml(r.courseName || "Course")}${r.multiCourse ? " ⚠" : ""} · Move ${r.moveNo}</h2>
        <div class="statline">${r.color === "w" ? "White" : "Black"} to move · you left the course here <span id="badPct">0%</span> of ${r.total} visit${r.total === 1 ? "" : "s"}</div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div id="feedback" class="feedback" aria-live="polite">Your move. Play what your course plays here.</div>
      <div class="btnrow mobile-actions">
        <button id="showBest">Show course move</button>
        <button id="resetBoard">Reset</button>
        <button id="toExplorer" title="Open this position in the line explorer">Explore</button>
        <button id="nextPos" class="next" ${hasNext ? "" : "disabled"}>Next →</button>
        ${r.url ? `<a href="${r.url}" target="_blank" rel="noopener"><button>Game ↗</button></a>` : ""}
      </div>
    </div>
    <p class="hint">Course continues with <b>${expectedSans(r)}</b>.</p>
    <table class="hist">
      <thead><tr><th>What you played instead</th><th>#</th><th>Win</th><th></th><th></th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;
  renderBoard();
  countUp($("badPct"), Math.round(r.badShare * 100), "%");
  wireDetailCommon(r);
  wireGamesButtons(r, () => selectUserDev(r, cardEl));
  openTrainer();
}

function selectOppDev(g, cardEl) {
  activateCard(cardEl);
  // The board shows the position you face right after their off-book move;
  // playing on it grades your reply with the engine (same as a window retry).
  const first = g.positions.find((p) => p.key === g.key);
  setupBoardFor(first || g);
  const theirExpected = (g.expected || []).map((e) => CMT.escapeHtml(e.san)).join(" or ");
  const rows = g.positions.map((p, i) => {
    const worst = p.plays[0];
    const posGameIds = [];
    for (const q of p.plays) for (const id of q.gameIds || []) posGameIds.push(id);
    return `<tr class="wrow" data-i="${i}" role="button" tabindex="0">
      <td>${p.moveNo}</td>
      <td><b>${CMT.escapeHtml(worst ? worst.san : "?")}</b>${p.plays.length > 1 ? ` <span class="hint">+${p.plays.length - 1}</span>` : ""}</td>
      <td>${winCellHtml(posGameIds)}</td>
      <td>${worst ? pills(worst.level, false, CMT.customBook.set.has(p.key + "|" + worst.uci)) : ""}</td>
      <td class="evalnum">${p.graded && p.total ? (p.plays.reduce((n, q) => n + q.cplSum, 0) / p.total).toFixed(0) + "cp" : "…"}</td>
      <td>${p.total}×</td></tr>`;
  }).join("");
  const idx = currentList.indexOf(g);
  const hasNext = idx >= 0 && idx < currentList.length - 1;
  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="backBtn" aria-label="Back to list">←</button>
      <div>
        <h2>${CMT.escapeHtml(g.courseName || "Course")}${g.multiCourse ? " ⚠" : ""} · Move ${g.moveNo}</h2>
        <div class="statline">Opponents played <b>${CMT.escapeHtml(g.theirMove.san)}</b> ${g.count}× (course prepares for ${theirExpected || "—"})
          · score ${winCellHtml(g.gameIds)} <button class="igbtn" id="groupGames">games</button></div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div id="feedback" class="feedback" aria-live="polite">Your move. How do you punish (or answer) <b>${CMT.escapeHtml(g.theirMove.san)}</b>?</div>
      <div class="btnrow mobile-actions">
        <button id="showBest" ${first && first.best ? "" : "disabled"}>Show best</button>
        <button id="resetBoard">Reset</button>
        <button id="toExplorer" title="Open this deviation in the line explorer">Explore</button>
        <button id="nextPos" class="next" ${hasNext ? "" : "disabled"}>Next →</button>
        ${g.url ? `<a href="${g.url}" target="_blank" rel="noopener"><button>Game ↗</button></a>` : ""}
      </div>
    </div>
    ${g.positions.length ? `
    <p class="hint">Your replies over the next moves (click one to load it):</p>
    <table class="hist">
      <thead><tr><th>Move</th><th>You played</th><th>Win</th><th>Grade</th><th>Avg loss</th><th>#</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : `<p class="hint">No replies on record (the games ended immediately after the deviation).</p>`}`;
  renderBoard();
  wireDetailCommon(first || g);
  const reopenGroup = () => selectOppDev(g, cardEl);
  const gg = $("groupGames");
  if (gg) gg.addEventListener("click", () => openGamesList({
    title: `Games where they played ${g.theirMove.san}`,
    gameIds: g.gameIds || [], jumpKey: g.key, back: reopenGroup,
  }));
  document.querySelectorAll(".wrow").forEach((row) => {
    const open = () => selectOppWindow(g.positions[+row.dataset.i], g);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  openTrainer();
}

function selectOppWindow(p, group) {
  group = group || (lastRep && lastRep.oppDev.find((g) => g.key === p.groupKey)) || null;
  requestPriorityGrade(p);
  setupBoardFor(p);
  const histRows = p.plays.map((q) => {
    const ig = CMT.customBook.set.has(p.key + "|" + q.uci);
    return `<tr><td><b>${CMT.escapeHtml(q.san)}</b></td><td>${q.count}</td>
      <td>${winCellHtml(q.gameIds)}</td>
      <td>${pills(q.level, false, ig)}</td>
      <td class="evalnum">${q.level == null ? "…" : (q.cplSum / q.count).toFixed(0) + "cp"}</td>
      <td class="rowbtns"><button class="igbtn gbtn" data-uci="${q.uci}">games</button>
        <button class="igbtn" data-uci="${q.uci}" data-san="${CMT.escapeHtml(q.san)}">${ig ? "unignore" : "ignore"}</button></td></tr>`;
  }).join("");
  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="backBtn" aria-label="Back to list">←</button>
      <div>
        <h2>After ${group ? "their <b>" + CMT.escapeHtml(group.theirMove.san) + "</b>" : "the deviation"} · Move ${p.moveNo}</h2>
        <div class="statline">${p.color === "w" ? "White" : "Black"} to move · seen ${p.total}× · bad <span id="badPct">0%</span></div>
      </div>
    </div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div id="feedback" class="feedback" aria-live="polite">Your move. Play the move you think is best.</div>
      <div class="btnrow mobile-actions">
        <button id="showBest">Show best</button>
        <button id="resetBoard">Reset</button>
        ${group ? `<button id="backToGroup">↩ Deviation</button>` : ""}
        ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener"><button>Game ↗</button></a>` : ""}
      </div>
    </div>
    <table class="hist">
      <thead><tr><th>Your moves here</th><th>#</th><th>Win</th><th>Grade</th><th>Avg loss</th><th></th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>`;
  renderBoard();
  countUp($("badPct"), Math.round(p.badShare * 100), "%");
  wireDetailCommon(p);
  if (group) $("backToGroup").addEventListener("click", () => {
    if (gradingPromise) return;
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === group.key);
    selectOppDev(group, el2 || null);
  });
  document.querySelectorAll(".igbtn:not(.gbtn)").forEach((b) => b.addEventListener("click", () => {
    CMT.toggleManualIgnore(p, b.dataset.uci, b.dataset.san);
    renderCustomBook();
    renderList();
    selectOppWindow(p, group);
  }));
  wireGamesButtons(p, () => selectOppWindow(p, group));
  openTrainer();
}

function resetCurrent() {
  const r = currentPos;
  if (!r || gradingPromise) return;
  interactionVersion++;
  boardState.chess = new Chess(r.fen);
  boardState.sel = null; boardState.best = null; boardState.locked = false;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback";
  fb.textContent = r.kind === "user-dev"
    ? "Your move. Play what your course plays here."
    : drillState.active
      ? "Your move. Play a move that avoids the mistake."
      : "Your move. Play the move you think is best.";
  syncDrillControls();
}

function syncAttemptControls() {
  const pending = !!gradingPromise || isImporting;
  for (const id of ["showBest", "resetBoard", "nextPos"]) {
    const button = $(id);
    if (!button) continue;
    if (id === "nextPos") {
      const index = currentListIndex();
      button.disabled = pending || index < 0 || index >= currentList.length - 1;
    } else {
      button.disabled = pending;
    }
  }
  syncDrillControls();
  refreshDrillAvailability();
}

// Course-move check for "I deviated" positions: no engine, instant verdict.
function retryCourseMove(r, from, to, promo) {
  const test = new Chess(r.fen);
  const mv = test.move({ from, to, promotion: promo });
  if (!mv) return;
  const userUci = from + to + (promo || "");
  const inDrill = drillState.active && !drillState.complete;
  const correct = r.answerUcis.includes(userUci);
  boardState.chess = test;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback " + (correct ? "good pop" : "bad");
  if (inDrill) {
    const outcome = drillOutcome(r.key);
    outcome.attempts++;
    if (outcome.firstTry == null) outcome.firstTry = outcome.attempts === 1 && !outcome.revealed && correct;
    if (correct) outcome.solved = true;
  }
  fb.innerHTML = correct
    ? `<b>${CMT.escapeHtml(mv.san)}</b> — that's the course move. ✓`
    : `<b>${CMT.escapeHtml(mv.san)}</b> is off-book. Course plays <b>${expectedSans(r)}</b>. <button class="igbtn" id="tryAgain">Try again</button>`;
  const ta = $("tryAgain");
  if (ta) ta.addEventListener("click", resetCurrent);
  if (correct) { boardState.best = userUci; drawArrow(); }
  syncDrillControls();
}

async function retryMove(from, to, promo) {
  const r = currentPos;
  if (!r || gradingPromise || isImporting || boardState.locked) return;
  if (r.kind === "user-dev") return retryCourseMove(r, from, to, promo);
  const test = new Chess(r.fen);
  const mv = test.move({ from, to, promotion: promo });
  if (!mv) return;
  const version = interactionVersion;
  const sessionId = drillState.sessionId;
  const inDrill = drillState.active && !drillState.complete;
  const positionKey = r.key;
  const userUci = from + to + (promo || "");
  boardState.locked = true;
  boardState.chess = test;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback";
  fb.textContent = "Thinking…";
  const s = inDrill ? drillState.settings : readSettings();
  let a;
  const work = (async () => {
    await ensureEngine();
    return CMT.analyzeMove({
      fenBefore: r.fen, fenAfter: test.fen(), uci: userUci,
      terminalAfter: test.game_over(), matedAfter: test.in_checkmate(),
    }, s.depth, s.th, engine);
  })();
  gradingPromise = work;
  syncRunDisabled();
  syncAttemptControls();
  const isCurrentAttempt = () =>
    interactionVersion === version &&
    currentPos && currentPos.key === positionKey &&
    (!inDrill || (drillState.active && drillState.sessionId === sessionId));
  try {
    a = await work;
  } catch (e) {
    if (isCurrentAttempt()) fb.textContent = "Engine error: " + e.message + ". Try again.";
    return;
  } finally {
    if (gradingPromise === work) gradingPromise = null;
    syncRunDisabled();
    if (isCurrentAttempt()) {
      boardState.locked = false;
      syncAttemptControls();
    }
  }
  if (!isCurrentAttempt()) return;

  const acceptedLevel = inDrill
    ? drillState.acceptByKey.get(positionKey)
    : 1;
  const acceptable = a.level <= (Number.isFinite(acceptedLevel) ? acceptedLevel : 1);
  const cls = acceptable ? "good" : a.level >= 4 ? "bad" : "warn";
  const bestSan = CMT.uciToSan(r.fen, a.best) || a.best;
  const same = userUci === a.best || a.cpl === 0;
  fb.className = "feedback " + cls + (cls === "good" ? " pop" : "");

  // Build feedback message
  let feedbackMsg = "";
  if (inDrill) {
    const outcome = drillOutcome(positionKey);
    outcome.attempts++;
    if (outcome.firstTry == null) {
      outcome.firstTry = outcome.attempts === 1 && !outcome.revealed && acceptable;
    }
    if (acceptable) outcome.solved = true;
    feedbackMsg = same
      ? `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b>! You found the engine's move.`
      : acceptable
        ? `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b>. That avoids the mistake; the engine preferred <b>${CMT.escapeHtml(bestSan)}</b>.`
        : `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b> (loses ${a.cpl.toFixed(0)}cp). Best was <b>${CMT.escapeHtml(bestSan)}</b>. <button class="igbtn" id="tryAgain">Try again</button>`;
  } else {
    feedbackMsg = same
      ? `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b>! The engine agrees. Hit <b>Next</b> to keep the streak going.`
      : `<b>${CMT.escapeHtml(mv.san)}</b> — <b>${LEVELS[a.level]}</b> (loses ${a.cpl.toFixed(0)}cp). Best was <b>${CMT.escapeHtml(bestSan)}</b>. <button class="igbtn" id="tryAgain">Try again</button>`;
  }

  fb.innerHTML = feedbackMsg;
  const ta = $("tryAgain");
  if (ta) ta.addEventListener("click", resetCurrent);
  boardState.best = a.best;
  drawArrow();
  syncDrillControls();
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
  lastResults = saved.results && saved.results.length ? saved.results : null;
  lastRep = saved.rep || null;
  setGameIndex(saved.gameIndex || null);
  if (saved.username) $("username").value = saved.username;
  $("exportBtn").disabled = false;
  const cached = await CMT.storage.count("evals");
  const what = appMode === "rep" && lastRep
    ? `${lastRep.userDev.length + lastRep.oppDev.length} deviations`
    : `${(saved.results || []).length} positions`;
  onStatus(`Restored last analysis (${saved.username || "?"}, ${what}). ${cached} cached evals on disk.`);
  renderList();
  // Resume any grading (and, in legacy mode, book annotation) left unfinished.
  if (ungradedQueue().length) startBackgroundGrading();
  else onBgDone();
}

// ----------------------------- line explorer -----------------------------
// Browse a course tree move by move; at every position see the games that
// followed the line this far, their win %, and how often you deviate here.
const explState = { courseId: null, sans: [], _repCache: {} };

// Deep-link a deviation into the explorer: walk the course to the deviation
// position (plus, for opp-dev, their off-book move so you land on the
// position you actually face).
function openInExplorer(r) {
  const courses = CMT.activeCourses();
  const course = courses.find((c) => r.courseIds && r.courseIds.includes(c.id)) || courses[0];
  if (!course) { onStatus("No course loaded."); return; }
  const targetKey = r.kind === "opp-dev" ? CMT.posKey(r.prevFen) : r.key;
  const path = CMT.pathToPosition(explorerRep(course), targetKey);
  if (path == null) { onStatus("Couldn't locate that position in the course tree."); return; }
  explState.courseId = course.id;
  explState.sans = r.kind === "opp-dev" ? path.concat(r.theirMove.san) : path;
  renderExplorer();
}

function explorerRep(course) {
  if (!explState._repCache[course.id]) {
    explState._repCache[course.id] = CMT.buildRepertoire([course], course.color);
  }
  return explState._repCache[course.id];
}

function openExplorer() {
  if (drillState.active) return;
  const courses = CMT.activeCourses();
  if (!courses.length) { onStatus("Load a course first (Settings → Repertoire courses)."); return; }
  if (!explState.courseId || !courses.some((c) => c.id === explState.courseId)) {
    explState.courseId = courses[0].id;
    explState.sans = [];
  }
  renderExplorer();
}

function closeExplorer() {
  currentPos = null;
  activePanelKeys = null;
  $("detail").innerHTML = '<p class="empty">Select a position to review and retry it.</p>';
  renderList();
}

function renderExplorer() {
  const courses = CMT.activeCourses();
  const course = courses.find((c) => c.id === explState.courseId) || courses[0];
  explState.courseId = course.id;
  const rep = explorerRep(course);

  // Replay the path (dropping anything now-invalid, e.g. after course switch).
  const chess = new Chess();
  const ok = [];
  for (const san of explState.sans) {
    let mv; try { mv = chess.move(san, { sloppy: true }); } catch (e) { mv = null; }
    if (!mv) break;
    ok.push(mv.san);
  }
  explState.sans = ok;
  const fen = chess.fen();
  const key = CMT.posKey(fen);
  const node = rep.get(key);
  const pi = getPosIndex();
  const stats = pi ? CMT.explorerStats(fen, rep, gameById, pi) : null;
  const playedBy = new Map((stats ? stats.played : []).map((p) => [p.uci, p]));
  const userTurn = fen.split(" ")[1] === course.color;

  const courseMoveBtns = node && node.moves.size
    ? [...node.moves].map(([uci, m]) => {
        const pl = playedBy.get(uci);
        const meta = pl ? ` <span class="hint">${pl.gameIds.length}g · ${pl.stats.pct != null ? pl.stats.pct + "%" : "–"}</span>` : "";
        return `<button class="explmv" data-san="${CMT.escapeHtml(m.san)}"><b>${CMT.escapeHtml(m.san)}</b>${meta}</button>`;
      }).join(" ")
    : '<span class="hint">End of the course\'s lines.</span>';

  const offBook = (stats ? stats.played : []).filter((p) => !p.inCourse);
  const playedRows = (stats ? stats.played : []).map((p) => `
    <tr><td><b>${CMT.escapeHtml(p.san)}</b> ${p.inCourse ? '<span class="pill Book">line</span>' : '<span class="pill OffBook">off</span>'}</td>
      <td>${p.gameIds.length}</td>
      <td>${winCellHtml(p.gameIds)}</td>
      <td class="rowbtns"><button class="igbtn egbtn" data-uci="${p.uci}">games</button></td></tr>`).join("");

  const crumbs = explState.sans.map((san, i) =>
    `${i % 2 === 0 ? `<span class="mvno">${i / 2 + 1}.</span>` : ""}<button class="mv crumb" data-i="${i}">${CMT.escapeHtml(san)}</button>`).join(" ");

  interactionVersion++;
  currentPos = null;
  boardState.chess = new Chess(fen);
  boardState.orient = course.color;
  boardState.sel = null; boardState.best = null; boardState.locked = false;
  boardState.onMove = (from, to, promo) => {
    const c2 = new Chess(fen);
    const mv = c2.move({ from, to, promotion: promo });
    if (!mv) return;
    explState.sans.push(mv.san);
    renderExplorer();
  };

  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="explClose" aria-label="Close explorer">←</button>
      <div class="expl-headmain">
        <h2>Line explorer</h2>
        <select id="explCourse" aria-label="Course">${courses.map((c) =>
          `<option value="${c.id}" ${c.id === course.id ? "selected" : ""}>${CMT.escapeHtml(c.shortName || c.name)} (${c.color === "w" ? "White" : "Black"})</option>`).join("")}</select>
      </div>
    </div>
    <div class="gv-moves expl-crumbs">${crumbs || '<span class="hint">Start position — click a course move or play on the board.</span>'}
      ${explState.sans.length ? '<button class="mv" id="explUndo">⌫ undo</button>' : ""}</div>
    <div class="board-wrap">
      <div id="board" class="board"></div>
      <div class="expl-coursemoves"><span class="hint">Course move${node && node.moves.size === 1 ? "" : "s"}:</span> ${courseMoveBtns}</div>
    </div>
    <div class="statline expl-stats">
      ${stats && stats.gameIds.length
        ? `Reached in <b>${stats.gameIds.length}</b> game${stats.gameIds.length === 1 ? "" : "s"} · score ${winCellHtml(stats.gameIds)}
           <button class="igbtn" id="explGames">games</button>`
        : gameIndex && gameIndex.length ? "None of your loaded games reached this position." : "Run an analysis to see your games along the line."}
    </div>
    ${stats && stats.userToMove && stats.deviationPct != null ? `
      <div class="statline ${stats.deviationPct > 0 ? "expl-dev" : ""}">You deviate from the line when playing this position
        <b>${stats.deviationPct}%</b> of the time (${stats.devTotal} of your moves here${offBook.length ? `, off-book: ${offBook.map((p) => CMT.escapeHtml(p.san)).join(", ")}` : ""}).</div>` : ""}
    ${playedRows ? `
    <table class="hist">
      <thead><tr><th>Played here (${userTurn ? "you" : "them"})</th><th>#</th><th>Win</th><th></th></tr></thead>
      <tbody>${playedRows}</tbody>
    </table>` : ""}`;

  renderBoard();
  activePanelKeys = {
    ArrowLeft: () => { if (explState.sans.length) { explState.sans.pop(); renderExplorer(); } },
    Escape: closeExplorer,
  };
  $("explClose").addEventListener("click", closeExplorer);
  $("explCourse").addEventListener("change", (e) => {
    explState.courseId = e.target.value;
    explState.sans = [];
    renderExplorer();
  });
  const undo = $("explUndo");
  if (undo) undo.addEventListener("click", () => { explState.sans.pop(); renderExplorer(); });
  document.querySelectorAll(".explmv").forEach((b) => b.addEventListener("click", () => {
    explState.sans.push(b.dataset.san);
    renderExplorer();
  }));
  document.querySelectorAll(".crumb").forEach((b) => b.addEventListener("click", () => {
    explState.sans = explState.sans.slice(0, +b.dataset.i);
    renderExplorer();
  }));
  const eg = $("explGames");
  if (eg) eg.addEventListener("click", () => openGamesList({
    title: "Games reaching this position", gameIds: stats.gameIds, jumpKey: key, back: renderExplorer,
  }));
  document.querySelectorAll(".egbtn").forEach((b) => b.addEventListener("click", () => {
    const p = stats.played.find((x) => x.uci === b.dataset.uci);
    if (p) openGamesList({ title: `Games with ${p.san} here`, gameIds: p.gameIds, jumpKey: key, back: renderExplorer });
  }));
  openTrainer();
}

// ----------------------------- course manager -----------------------------
function renderCourses() {
  const el = $("courseList");
  if (!el) return;
  const courses = CMT.activeCourses();
  $("restoreCourses").hidden = !CMT.courseManager.removedIds.length;
  if (!courses.length) {
    el.innerHTML = '<p class="hint">No courses loaded. Import a Chessly crawl or paste lines below.</p>';
    return;
  }
  el.innerHTML = "";
  for (const c of courses) {
    const nPos = Object.keys(c.positions || {}).length;
    const row = document.createElement("div");
    row.className = "cbrow";
    row.innerHTML = `<span class="cbl">${CMT.escapeHtml(c.shortName || c.name)}</span>
      <span class="hint">${c.color === "w" ? "White" : "Black"} · ${nPos} positions${c.custom ? " · custom" : ""}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = "Remove course";
    btn.setAttribute("aria-label", "Remove course " + (c.shortName || c.name));
    btn.addEventListener("click", () => { CMT.removeCourse(c.id); renderCourses(); });
    row.appendChild(btn);
    el.appendChild(row);
  }
}

// ----------------------------- keyboard -----------------------------
function onKeydown(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (e.key === "Escape") {
    if ($("drawer").classList.contains("show")) { setDrawer(false); return; }
    if (drillState.active) { requestExitDrill(false); return; }
    if (!$("drillSetup").hidden) { closeDrillSetup(); return; }
    if (activePanelKeys && activePanelKeys.Escape) { activePanelKeys.Escape(); return; }
    if (document.body.classList.contains("trainer-open")) { requestCloseTrainer(); return; }
  }
  if (["input", "textarea", "select", "button", "a"].includes(tag) || e.target.isContentEditable) return;
  if (activePanelKeys) { // sub-view owns the keyboard
    const fn = activePanelKeys[e.key];
    if (fn) { e.preventDefault(); fn(); }
    return;
  }
  if (drillState.active) {
    if (drillState.complete || gradingPromise) return;
    if ((e.key === "ArrowDown" || e.key === "n" || e.key === "N") && !e.repeat) {
      e.preventDefault();
      const next = $("drillNext");
      if (next) next.click();
    } else if (e.key === "b" || e.key === "B") {
      const reveal = $("drillReveal");
      if (reveal) reveal.click();
    } else if (e.key === "r" || e.key === "R") {
      const reset = $("drillReset");
      if (reset) reset.click();
    }
    return;
  }
  if (!currentList.length) return;
  if (gradingPromise) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const i = currentListIndex();
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
  loadDrillPrefs();

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

  // Piece sets (async; board re-renders when ready or changed)
  Pieces.onChange(() => {
    miniBoardCache.clear();
    const sel = $("pieceSet");
    if (sel) sel.value = Pieces.id() === "classic" ? (localStorage.getItem("cmt-piece-set") || "classic") : Pieces.id();
    if (!drillState.active) renderList();
    if ($("board") && boardState.chess) renderBoard();
  });
  Pieces.init();
  $("pieceSet").addEventListener("change", async (e) => {
    const before = Pieces.id();
    const got = await Pieces.activate(e.target.value);
    if (got === "classic" && e.target.value === "cburnett") {
      onStatus("Couldn't fetch the lichess pieces (offline?). Using classic set for now.");
    } else if (got === "classic" && e.target.value === "custom") {
      onStatus("No custom pieces uploaded yet — pick 12 files below.");
      e.target.value = before;
    }
  });
  $("pieceFiles").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    try {
      await Pieces.importCustom(files);
      $("pieceSet").value = "custom";
      onStatus("Custom pieces loaded.");
    } catch (err) { onStatus("Custom pieces: " + err.message); }
  });

  // Line explorer
  $("openExplorer").addEventListener("click", openExplorer);

  // Mode toggle (persisted; repertoire is the default)
  let savedMode = "rep";
  try { savedMode = localStorage.getItem(MODE_KEY) || "rep"; } catch (e) { /* default */ }
  setMode(savedMode, { silent: true });
  $("modeRep").addEventListener("click", () => { if (appMode !== "rep") setMode("rep"); });
  $("modeLegacy").addEventListener("click", () => { if (appMode !== "legacy") setMode("legacy"); });

  // Repertoire courses: bundled + persisted imports
  CMT.setBundledCourses(window.CMT_COURSES || []);
  CMT.loadCourses().then(renderCourses);
  $("devFilter").addEventListener("change", renderList);
  $("restoreCourses").addEventListener("click", () => { CMT.restoreRemovedCourses(); renderCourses(); });
  $("courseFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    let added = 0;
    for (const f of files) {
      try {
        const course = CMT.courseFromChesslyRaw(JSON.parse(await f.text()));
        CMT.importCourse(course);
        added++;
      } catch (err) {
        onStatus(`Could not import ${f.name}: ${err.message}`);
      }
    }
    if (added) { renderCourses(); onStatus(`Imported ${added} course${added === 1 ? "" : "s"}. Re-run the analysis to use them.`); }
  });
  $("addCourseLines").addEventListener("click", () => {
    const text = $("courseLineInput").value.trim();
    if (!text) { onStatus("Paste one or more lines first."); return; }
    try {
      const course = CMT.courseFromLines(text, $("courseLineName").value.trim() || undefined, $("courseLineColor").value);
      CMT.importCourse(course);
      renderCourses();
      $("courseLineInput").value = "";
      $("courseLineName").value = "";
      onStatus(`Added course “${course.name}” (${Object.keys(course.positions).length} positions). Re-run the analysis to use it.`);
    } catch (err) { onStatus("Could not parse lines: " + err.message); }
  });

  // Core flows
  CMT.loadCustomBook().then(() => { renderCustomBook(); return restoreSession(); });
  $("run").addEventListener("click", () => run(null));
  $("heroRun") && $("heroRun").addEventListener("click", () => run(null));
  $("stop").addEventListener("click", () => {
    control.stop = true;
    stopBackgroundGrading();
    onStatus("Stopping after current move…");
  });
  $("openDrill").addEventListener("click", openDrillSetup);
  $("cancelDrillSetup").addEventListener("click", closeDrillSetup);
  $("startDrill").addEventListener("click", startDrill);
  for (const id of ["drillMinOcc", "drillMinRate", "drillLimit"]) {
    $(id).addEventListener(id === "drillLimit" ? "change" : "input", updateDrillPoolPreview);
  }

  for (const [id, evt] of [
    ["showAll", "change"], ["sortBy", "change"], ["ignoreBook", "change"], ["hideBefore", "input"],
    ["minOcc", "input"], ["flagShare", "input"],
    ["phOpenEnd", "input"], ["phMidEnd", "input"],
    ["accOpen", "change"], ["accMid", "change"], ["accEnd", "change"],
  ]) {
    $(id).addEventListener(evt, renderList);
  }
  refreshDrillAvailability();

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
    if (gradingPromise || isImporting) {
      onStatus("Wait for the current operation to finish before clearing saved data.");
      return;
    }
    if (drillState.active) exitDrillForDataChange();
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
    if (!lastResults && !lastRep) return;
    onStatus("Exporting backup…");
    await CMT.storage.set("sessions", "themes", Themes.data());
    const payload = await CMT.buildExport($("username").value, readSettings(), lastResults || [], { rep: lastRep, mode: appMode });
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chess-mistakes-" + ($("username").value || "results") + ".json";
    a.click();
    onStatus(`Exported ${(lastResults || []).length} positions`
      + (lastRep ? `, ${lastRep.userDev.length + lastRep.oppDev.length} deviations` : "")
      + ` and ${Object.keys(payload.evals).length} cached evals.`);
  });

  $("importFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (gradingPromise) {
      onStatus("Wait for the current move to finish grading before importing a backup.");
      return;
    }
    isImporting = true;
    boardState.locked = true;
    syncRunDisabled();
    syncAttemptControls();
    try {
      const data = JSON.parse(await f.text());
      const imported = await CMT.applyImport(data, engine);
      const { results, rep, summary } = imported;
      if (drillState.active) exitDrillForDataChange();
      stopBackgroundGrading();
      lastResults = results && results.length ? results : null;
      lastRep = rep || null;
      setGameIndex(imported.gameIndex || null);
      if (summary.username) $("username").value = summary.username;
      if (data.themes) { Themes.importData(data.themes); renderThemeUI(); }
      if (summary.mode) setMode(summary.mode, { silent: true });
      $("exportBtn").disabled = false;
      renderCustomBook();
      renderCourses();
      renderList();
      onStatus(`Loaded ${summary.positions} positions`
        + (summary.rep ? " + repertoire results" : "")
        + (summary.evals ? ` + ${summary.evals} cached evals` : "")
        + (summary.customGroups ? ` + ${summary.customGroups} custom line group(s)` : "")
        + (summary.courses ? ` + ${summary.courses} imported course(s)` : "")
        + (summary.themes ? " + themes" : "")
        + " from file.");
    } catch (err) {
      onStatus("Could not read backup: " + err.message);
    } finally {
      isImporting = false;
      if (currentPos && !gradingPromise) boardState.locked = false;
      syncRunDisabled();
      syncAttemptControls();
    }
  });

  // Mobile back navigation
  window.addEventListener("popstate", () => {
    if (drillState.active) exitDrillNow();
    else closeTrainer();
  });

  // Keyboard
  document.addEventListener("keydown", onKeydown);

  // Persist queued eval writes when the tab closes.
  window.addEventListener("pagehide", () => { CMT.storage.flush(); });
}

document.addEventListener("DOMContentLoaded", init);
