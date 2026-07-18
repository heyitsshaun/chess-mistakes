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
let isImporting = false;
let isBookChecking = false;
let gradingPromise = null;
let interactionVersion = 0;
const control = { stop: false };
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

// Comparison mode state
const comparisonState = {
  active: false,
  panelOpen: false,
};
let comparisonShowDeviations = false;

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
  if (!lastResults) {
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
        <div class="meta">bad ${(r.badShare * 100).toFixed(0)}% · avg loss ${r.avgCpl.toFixed(0)}cp · best <b>${CMT.escapeHtml(CMT.uciToSan(r.fen, r.best) || r.best || "?")}</b></div>
      </div>
      <span class="chev">›</span>`;
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
  if (!lastResults || !lastResults.length) return [];
  CMT.recomputeFlags(lastResults, readSettings(), $("ignoreBook").checked, CMT.customBook.set);
  return CMT.filterDrillPositions(lastResults, config)
    .filter((r) => r.fen && r.best);
}

function refreshDrillAvailability() {
  const button = $("openDrill");
  const count = $("drillEligibleCount");
  if (!button || !count) return;
  const pool = computeDrillPool(currentDrillConfig());
  button.disabled = !lastResults || !lastResults.length || isRunning || isImporting || isBookChecking || !!gradingPromise;
  count.textContent = isBookChecking ? "Checking book…" : lastResults ? `${pool.length} eligible` : "Analyze first";
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
  if (!lastResults || !lastResults.length) {
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
        <div id="feedback" class="feedback" aria-live="polite">Your move. Play a move that avoids the mistake.</div>
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
  boardState.best = currentPos.best;
  drawArrow();
  const bestSan = CMT.uciToSan(currentPos.fen, currentPos.best) || currentPos.best || "?";
  const fb = $("feedback");
  fb.className = "feedback";
  fb.innerHTML = `Best move: <b>${CMT.escapeHtml(bestSan)}</b>. You can try it, then continue.`;
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
  interactionVersion++;
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
    requestCloseTrainer();
  });
  document.querySelectorAll(".igbtn").forEach((b) => b.addEventListener("click", () => {
    CMT.toggleManualIgnore(r, b.dataset.uci, b.dataset.san);
    renderCustomBook();
    renderList();
    const el2 = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === r.key);
    selectPosition(r, el2 || null);
  }));
  $("showBest").addEventListener("click", () => {
    if (gradingPromise) return;
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
  if (!r || gradingPromise) return;
  interactionVersion++;
  boardState.chess = new Chess(r.fen);
  boardState.sel = null; boardState.best = null; boardState.locked = false;
  renderBoard();
  const fb = $("feedback");
  fb.className = "feedback";
  fb.textContent = drillState.active
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
      const index = currentList.indexOf(currentPos);
      button.disabled = pending || index < 0 || index >= currentList.length - 1;
    } else {
      button.disabled = pending;
    }
  }
  syncDrillControls();
  refreshDrillAvailability();
}

async function retryMove(from, to, promo) {
  const r = currentPos;
  if (!r || gradingPromise || isImporting || boardState.locked) return;
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

  // Check comparison mode
  let comparisonInfo = null;
  if (CMT.comparison.session) {
    const cmpResult = CMT.comparePosition(userUci, mv.san, r.fen);
    comparisonInfo = cmpResult;
  }

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

  // Add comparison feedback if applicable
  if (comparisonInfo && CMT.comparison.session) {
    if (comparisonInfo.isMatch) {
      feedbackMsg += ` <span class="comparison-match">✓ Matches prepared line</span>`;
    } else if (comparisonInfo.deviation) {
      const dev = comparisonInfo.deviation;
      feedbackMsg += ` <span class="comparison-deviation">Deviates from line (expected ${CMT.escapeHtml(dev.expectedSan)})</span>`;
    }
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
  lastResults = saved.results;
  if (saved.username) $("username").value = saved.username;
  $("exportBtn").disabled = false;
  const cached = await CMT.storage.count("evals");
  onStatus(`Restored last analysis (${saved.username || "?"}, ${saved.results.length} positions). ${cached} cached evals on disk.`);
  const s = readSettings();
  const needsBook = s.bookMax > 0 && lastResults.some((r) => r.moveNo <= s.bookMax && !r.bookKnown);
  isBookChecking = needsBook;
  renderList();
  if (needsBook) {
    try {
      await CMT.annotateBook(lastResults, s, { onStatus, control });
      CMT.saveSession(saved.username, lastResults);
      onStatus("Opening-book check complete.");
    } catch (e) {
      onStatus("Opening-book check could not finish: " + e.message);
    } finally {
      isBookChecking = false;
      renderList();
    }
  }
}

// ----------------------------- comparison mode UI -----------------------------
async function renderComparisonPanel() {
  const el = $("comparisonPanel");
  if (!el) return;

  const lines = CMT.comparison.lines;
  if (!lines.length) {
    el.innerHTML = `<div class="comparison-empty">
      <p>No custom lines loaded yet.</p>
      <p>Add a line using the import panel above.</p>
    </div>`;
    return;
  }

  const session = CMT.comparison.session;
  const stats = session ? CMT.getComparisonStats() : null;
  const activeLine = session ? CMT.getActiveComparisonLine() : null;

  let html = `<div class="comparison-container">
    <div class="comparison-header">
      <h3>Comparison Lines</h3>
      <span class="hint">${lines.length} line${lines.length === 1 ? "" : "s"}</span>
    </div>`;

  if (session && activeLine) {
    html += `<div class="comparison-active">
      <div class="comparison-line-header">
        <strong>${CMT.escapeHtml(activeLine.name)}</strong>
        <span class="hint">${activeLine.uciMoves.length} moves</span>
      </div>`;

    if (stats) {
      html += `<div class="comparison-stats">
        <span>Matched: <b>${stats.matchedMoves}</b>/${stats.totalMoves} (${stats.matchRate}%)</span>`;
      if (stats.deviationMoves > 0) {
        html += `<span>Deviations: <b>${stats.deviationMoves}</b></span>`;
      }
      html += `</div>`;

      if (stats.deviations.length > 0) {
        html += `<div class="comparison-deviations-preview">
          <button id="showDeviations" type="button">Show deviations (${stats.deviations.length})</button>
        </div>`;
      }
    }

    html += `</div>`;
  }

  html += `<div class="comparison-lines-list">`;
  for (const line of lines) {
    const isActive = session && session.activeLineId === line.id;
    html += `<div class="comparison-line-item ${isActive ? "active" : ""}">
      <div class="comparison-line-label">${CMT.escapeHtml(line.name)}</div>
      <div class="comparison-line-meta">
        <span class="hint">${line.uciMoves.length} moves</span>
        <button class="close-btn" data-lineid="${line.id}" title="Remove line">✕</button>
      </div>
      ${isActive ? '<span class="hint">active</span>' : ''}
    </div>`;
  }
  html += `</div></div>`;

  el.innerHTML = html;

  // Wire events
  for (const btn of el.querySelectorAll(".close-btn")) {
    btn.addEventListener("click", () => {
      const lineId = btn.dataset.lineid;
      CMT.removeComparisonLine(lineId);
      renderComparisonPanel();
      renderList();
    });
  }

  const showBtn = el.querySelector("#showDeviations");
  if (showBtn) {
    showBtn.addEventListener("click", () => {
      comparisonShowDeviations = !comparisonShowDeviations;
      renderComparisonDeviations();
    });
  }
}

function renderComparisonDeviations() {
  const el = $("comparisonDeviations");
  if (!el) return;

  const stats = CMT.comparison.session ? CMT.getComparisonStats() : null;
  if (!stats || !stats.deviations.length) {
    el.innerHTML = "";
    return;
  }

  if (!comparisonShowDeviations) {
    el.innerHTML = "";
    return;
  }

  let html = `<div class="comparison-deviations">
    <h4>Deviations from loaded line</h4>
    <table class="comparison-dev-table">
      <thead><tr>
        <th>Move #</th><th>Position</th><th>Expected</th><th>Played</th><th></th>
      </tr></thead>
      <tbody>`;

  for (const dev of stats.deviations) {
    html += `<tr>
      <td>${dev.moveNo}</td>
      <td class="hint">${dev.posKey.slice(0, 8)}…</td>
      <td><b>${CMT.escapeHtml(dev.expectedSan)}</b></td>
      <td><b>${CMT.escapeHtml(dev.actualSan)}</b></td>
      <td><button class="sm-btn" data-poskey="${dev.posKey}">View</button></td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  el.innerHTML = html;

  for (const btn of el.querySelectorAll(".sm-btn")) {
    btn.addEventListener("click", () => {
      // User could click to jump to deviation position in analysis view
      onStatus("Deviation position noted. Review in analysis.");
    });
  }
}

async function openComparisonImport() {
  const el = $("comparisonImport");
  if (!el) return;
  el.hidden = false;
  $("comparisonLineInput").focus();
}

function closeComparisonImport() {
  const el = $("comparisonImport");
  if (!el) return;
  el.hidden = true;
  $("comparisonLineInput").value = "";
}

async function addComparisonLine() {
  const text = $("comparisonLineInput").value.trim();
  const label = $("comparisonLineLabel").value.trim();
  if (!text) {
    onStatus("Paste opening moves (PGN or SAN format)");
    return;
  }

  try {
    const line = CMT.importComparisonLine(text, label || undefined);
    renderComparisonPanel();
    renderList();
    closeComparisonImport();
    onStatus(`Added line: ${line.name} (${line.uciMoves.length} moves)`);

    // Auto-init session if not already active
    if (!CMT.comparison.session && CMT.comparison.lines.length > 0) {
      CMT.initComparisonSession(CMT.comparison.lines.map((l) => l.id));
      renderComparisonPanel();
    }
  } catch (e) {
    onStatus("Invalid line: " + e.message);
  }
}

// ----------------------------- keyboard -----------------------------
function onKeydown(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (e.key === "Escape") {
    if ($("drawer").classList.contains("show")) { setDrawer(false); return; }
    if (drillState.active) { requestExitDrill(false); return; }
    if (!$("drillSetup").hidden) { closeDrillSetup(); return; }
    if (document.body.classList.contains("trainer-open")) { requestCloseTrainer(); return; }
  }
  if (["input", "textarea", "select", "button", "a"].includes(tag) || e.target.isContentEditable) return;
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

  // Core flows
  CMT.loadCustomBook().then(() => { renderCustomBook(); return restoreSession(); });
  CMT.loadComparisonLines().then(() => { renderComparisonPanel(); });
  $("run").addEventListener("click", () => run(null));
  $("heroRun") && $("heroRun").addEventListener("click", () => run(null));
  $("stop").addEventListener("click", () => { control.stop = true; onStatus("Stopping after current move…"); });
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

  // Comparison mode
  if ($("openComparison")) {
    $("openComparison").addEventListener("click", () => {
      openComparisonImport();
    });
  }
  if ($("comparisonLineInput")) {
    $("comparisonLineInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); addComparisonLine(); }
    });
  }
  if ($("addComparisonLine")) {
    $("addComparisonLine").addEventListener("click", addComparisonLine);
  }
  if ($("closeComparisonImport")) {
    $("closeComparisonImport").addEventListener("click", closeComparisonImport);
  }

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
      const { results, summary } = await CMT.applyImport(data, engine);
      if (drillState.active) exitDrillForDataChange();
      lastResults = results;
      if (summary.username) $("username").value = summary.username;
      if (data.themes) { Themes.importData(data.themes); renderThemeUI(); }
      $("exportBtn").disabled = false;
      renderCustomBook();
      renderList();
      onStatus(`Loaded ${summary.positions} positions`
        + (summary.evals ? ` + ${summary.evals} cached evals` : "")
        + (summary.customGroups ? ` + ${summary.customGroups} custom line group(s)` : "")
        + (summary.comparisonLines ? ` + ${summary.comparisonLines} comparison line(s)` : "")
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
