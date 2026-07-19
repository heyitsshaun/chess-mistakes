/* Chess Mistake Trainer — drill-down views.
 * The games list, game viewer, and line explorer. Split from app.js for
 * maintainability; loaded after it (classic scripts share top-level scope,
 * and these functions are only invoked at runtime, after all scripts load).
 * Depends on app.js state/helpers (gameById, boardState, renderBoard,
 * activePanelKeys, openTrainer, …) and core.js (CMT).
 */
"use strict";

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

// ----------------------------- drill stats -----------------------------
// Presentation over the append-only drill log (CMT.loadDrillLog →
// CMT.drillMetrics). All aggregation happens in core at read time, so this
// view can be reshaped freely without touching stored data.
async function openDrillStats(sort) {
  if (drillState.active) return;
  const rounds = await CMT.loadDrillLog();
  renderDrillStats(CMT.drillMetrics(rounds), sort || "drilled");
}

function drillStatsLabel(p) {
  const name = p.courseName || p.opening || "Position";
  const kind = { "user-dev": "course move", "opp-window": "reply", "opp-dev": "reply", engine: "engine" }[p.kind] || "";
  return `<b>${CMT.escapeHtml(name)}</b><span class="hint">${p.moveNo ? ` · move ${p.moveNo}` : ""}${kind ? ` · ${kind}` : ""}</span>`;
}

function renderDrillStats(m, sort) {
  const havePositions = m.positions.length > 0;
  const totalAttempts = m.positions.reduce((n, p) => n + p.total, 0);
  const totalFirst = m.positions.reduce((n, p) => n + p.attempts.filter((a) => a.result === "first").length, 0);
  const recent = m.sessions.slice(-5);
  const earlier = m.sessions.slice(0, -5);
  const avgOf = (arr) => (arr.length ? arr.reduce((n, s) => n + s.avgScore, 0) / arr.length : null);
  const recentAvg = avgOf(recent);
  const earlierAvg = avgOf(earlier);

  const sorted = m.positions.slice();
  if (sort === "struggling") sorted.sort((a, b) => a.avgScore - b.avgScore || b.total - a.total);
  else if (sort === "improving") sorted.sort((a, b) => (b.trend == null ? -Infinity : b.trend) - (a.trend == null ? -Infinity : a.trend));
  else if (sort === "recent") sorted.sort((a, b) => String(b.attempts[b.attempts.length - 1].at).localeCompare(String(a.attempts[a.attempts.length - 1].at)));
  else sorted.sort((a, b) => b.total - a.total);

  const DOT = { first: "--best", recovered: "--good", revealed: "--mistake", skipped: "--faint" };
  const rows = sorted.map((p) => {
    const dots = p.attempts.slice(-6).map((a) =>
      `<span class="dsdot" style="background:var(${DOT[a.result] || "--faint"})" title="${a.result}${a.at ? " · " + String(a.at).slice(0, 10) : ""}"></span>`).join("");
    const trend = p.trend == null
      ? '<span class="hint">–</span>'
      : p.trend > 0.12 ? '<span class="ds-up">↑ improving</span>'
      : p.trend < -0.12 ? '<span class="ds-down">↓ slipping</span>'
      : '<span class="ds-flat">→ steady</span>';
    const inResults = !!positionForDrillKey(p.key);
    return `<tr class="dsrow${inResults ? "" : " ds-gone"}" data-key="${CMT.escapeHtml(p.key)}" role="button" tabindex="0"
      ${inResults ? "" : 'title="Not in the current results — re-run the analysis to open it"'}>
      <td>${drillStatsLabel(p)}</td>
      <td>${p.total}×</td>
      <td class="ds-dots">${dots}</td>
      <td>${Math.round(p.avgScore * 100)}%</td>
      <td>${trend}</td></tr>`;
  }).join("");

  const roundLines = m.sessions.slice(-8).reverse().map((s) =>
    `<span class="hint">${String(s.at).slice(0, 10)} · ${s.positions} pos · ${s.firstTryPct}% first-try</span>`).join("<br>");

  $("detail").innerHTML = `
    <div class="detail-head">
      <button class="iconbtn backbtn" id="dsBack" aria-label="Back">←</button>
      <div>
        <h2>Drill stats</h2>
        <div class="statline">${m.sessions.length} round${m.sessions.length === 1 ? "" : "s"} · ${m.positions.length} position${m.positions.length === 1 ? "" : "s"} drilled · ${totalAttempts} attempt${totalAttempts === 1 ? "" : "s"}</div>
      </div>
    </div>
    ${havePositions ? `
    <div class="drill-summary-grid ds-summary">
      <div class="drill-summary-stat"><span class="drill-summary-value">${totalAttempts ? Math.round((totalFirst / totalAttempts) * 100) : 0}%</span><span class="drill-summary-label">First try overall</span></div>
      <div class="drill-summary-stat"><span class="drill-summary-value">${recentAvg == null ? "–" : Math.round(recentAvg * 100) + "%"}</span><span class="drill-summary-label">Score, last ${recent.length} round${recent.length === 1 ? "" : "s"}</span></div>
      <div class="drill-summary-stat"><span class="drill-summary-value">${earlierAvg == null ? "–" : (recentAvg >= earlierAvg ? "+" : "") + Math.round((recentAvg - earlierAvg) * 100) + "pt"}</span><span class="drill-summary-label">vs earlier rounds</span></div>
    </div>
    <div class="btnrow ds-tools">
      <select id="dsSort" aria-label="Sort drill stats">
        <option value="drilled" ${sort === "drilled" ? "selected" : ""}>Most drilled</option>
        <option value="struggling" ${sort === "struggling" ? "selected" : ""}>Still struggling</option>
        <option value="improving" ${sort === "improving" ? "selected" : ""}>Most improved</option>
        <option value="recent" ${sort === "recent" ? "selected" : ""}>Recently drilled</option>
      </select>
    </div>
    <table class="hist ds-table">
      <thead><tr><th>Position</th><th>Drilled</th><th>Last results</th><th>Score</th><th>Trend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">Score: first-try = 100%, recovered = 50%, revealed/skipped = 0%. Trend compares your last 3 attempts to everything before. Click a row to open the position.</p>
    ${roundLines ? `<p class="hint"><b>Recent rounds</b><br>${roundLines}</p>` : ""}
    ` : `<p class="hint">No drills recorded yet. Finish a shuffle drill and your results start accumulating here — every round is saved, so you can watch positions move from "slipping" to "improving".</p>`}`;

  interactionVersion++;
  currentPos = null;
  activePanelKeys = { Escape: closeExplorer };
  $("dsBack").addEventListener("click", closeExplorer);
  const sel = $("dsSort");
  if (sel) sel.addEventListener("change", () => renderDrillStats(m, sel.value));
  document.querySelectorAll(".dsrow").forEach((row) => {
    const open = () => {
      const r = positionForDrillKey(row.dataset.key);
      if (!r) { onStatus("That position isn't in the current results — re-run the analysis to open it."); return; }
      const el = [...document.querySelectorAll(".card")].find((c) => c.dataset.key === (r.groupKey || r.key));
      if (r.kind === "opp-window") selectOppWindow(r);
      else selectPosition(r, el || null);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  openTrainer();
}

// ----------------------------- course-line overlay -----------------------------
// Chessly-style peek at the course from a deviation, without leaving the
// trainer panel: the course line to this position (rewindable move by move)
// and the course's continuations from wherever you step to. Opens as an
// overlay on top of the current detail view.
const linesOverlay = { el: null, keyHandler: null, st: null };

function openLinesOverlay(r) {
  const courses = CMT.activeCourses();
  const course = courses.find((c) => r.courseIds && r.courseIds.includes(c.id)) || courses[0];
  if (!course) { onStatus("No course loaded."); return; }
  const targetKey = r.kind === "opp-dev" ? CMT.posKey(r.prevFen) : r.key;
  const path = CMT.pathToPosition(explorerRep(course), targetKey);
  if (path == null) { onStatus("Couldn't locate that position in the course tree."); return; }
  // For opp-dev, include their off-book move so the line ends on the position
  // you actually face; everything before it is course theory.
  const sans = r.kind === "opp-dev" ? path.concat(r.theirMove.san) : path.slice();
  linesOverlay.st = { course, sans, ply: sans.length, gamePlies: sans.length, posRef: r };
  if (!linesOverlay.el) {
    const wrap = document.createElement("div");
    wrap.className = "lo-scrim";
    wrap.innerHTML = '<div class="lines-overlay" role="dialog" aria-modal="true" aria-label="Course line"></div>';
    wrap.addEventListener("click", (e) => { if (e.target === wrap) closeLinesOverlay(); });
    document.body.appendChild(wrap);
    linesOverlay.el = wrap;
    linesOverlay.keyHandler = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLinesOverlay(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); linesOverlayStep(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); linesOverlayStep(1); }
    };
    document.addEventListener("keydown", linesOverlay.keyHandler, true);
  }
  renderLinesOverlay();
}

function closeLinesOverlay() {
  if (linesOverlay.el) { linesOverlay.el.remove(); linesOverlay.el = null; }
  if (linesOverlay.keyHandler) {
    document.removeEventListener("keydown", linesOverlay.keyHandler, true);
    linesOverlay.keyHandler = null;
  }
  linesOverlay.st = null;
}

// ← rewinds, → steps forward; at the tip, → follows the course when it has
// exactly one continuation.
function linesOverlayStep(d) {
  const st = linesOverlay.st;
  if (!st) return;
  if (d < 0 && st.ply > 0) { st.ply--; renderLinesOverlay(); return; }
  if (d > 0) {
    if (st.ply < st.sans.length) { st.ply++; renderLinesOverlay(); return; }
    const rep = explorerRep(st.course);
    const chess = new Chess();
    for (const san of st.sans) { try { chess.move(san, { sloppy: true }); } catch (e) { return; } }
    const node = rep.get(CMT.posKey(chess.fen()));
    if (node && node.moves.size === 1) {
      st.sans.push([...node.moves.values()][0].san);
      st.ply = st.sans.length;
      renderLinesOverlay();
    }
  }
}

function renderLinesOverlay() {
  const st = linesOverlay.st;
  if (!st || !linesOverlay.el) return;
  const course = st.course;
  const rep = explorerRep(course);

  // Replay the line, dropping anything invalid, and collect per-ply FENs.
  const chess = new Chess();
  const fens = [chess.fen()];
  const ok = [];
  for (const san of st.sans) {
    let mv; try { mv = chess.move(san, { sloppy: true }); } catch (e) { mv = null; }
    if (!mv) break;
    ok.push(mv.san);
    fens.push(chess.fen());
  }
  st.sans = ok;
  st.ply = Math.min(Math.max(0, st.ply), ok.length);
  st.gamePlies = Math.min(st.gamePlies, ok.length);
  const fen = fens[st.ply];
  const key = CMT.posKey(fen);
  const node = rep.get(key);
  const userTurn = fen.split(" ")[1] === course.color;

  const crumbs = st.sans.map((san, i) => {
    const off = st.posRef.kind === "opp-dev" && i === st.gamePlies - 1;
    const beyond = i >= st.gamePlies;
    return `${i % 2 === 0 ? `<span class="mvno">${i / 2 + 1}.</span>` : ""}`
      + `<button class="mv locrumb${i + 1 === st.ply ? " cur" : ""}${off ? " lo-offbook" : ""}${beyond ? " lo-beyond" : ""}"`
      + ` data-ply="${i + 1}" ${off ? 'title="Their off-book move"' : beyond ? 'title="Explored beyond the game"' : ""}>${CMT.escapeHtml(san)}</button>`;
  }).join(" ");

  const courseMoveBtns = node && node.moves.size
    ? [...node.moves].map(([uci, m]) =>
        `<button class="explmv lomv" data-san="${CMT.escapeHtml(m.san)}"><b>${CMT.escapeHtml(m.san)}</b></button>`).join(" ")
    : '<span class="hint">End of the course\'s lines.</span>';

  // At the deviation position itself, say what happened there.
  let devNote = "";
  const pr = st.posRef;
  if (pr.kind === "user-dev" && key === pr.key) {
    const played = pr.plays && pr.plays[0] ? pr.plays[0].san : null;
    devNote = `<p class="statline lo-devnote">This is where you deviate${played ? `: you played <b>${CMT.escapeHtml(played)}</b>` : ""}; course plays <b>${expectedSans(pr)}</b>.</p>`;
  } else if (pr.kind === "opp-dev" && st.ply === st.gamePlies && st.gamePlies > 0) {
    devNote = `<p class="statline lo-devnote">Their <b>${CMT.escapeHtml(pr.theirMove.san)}</b> left the course here (it prepares for ${expectedSans(pr) || "—"}).</p>`;
  }

  linesOverlay.el.querySelector(".lines-overlay").innerHTML = `
    <div class="lo-head">
      <div>
        <div class="lo-kicker">Course line</div>
        <h2>${CMT.escapeHtml(course.name)}</h2>
        <div class="statline">${course.color === "w" ? "White" : "Black"} repertoire · ${userTurn ? "your move" : "their move"} at this point</div>
      </div>
      <button class="iconbtn" id="loClose" aria-label="Close">✕</button>
    </div>
    <div class="gv-moves lo-crumbs">${crumbs || '<span class="hint">Start position.</span>'}</div>
    <div class="lo-board">${miniBoardSVG(fen, course.color)}</div>
    <div class="btnrow lo-nav">
      <button id="loStart" title="Start position">⏮</button>
      <button id="loPrev" title="Rewind one move (←)">←</button>
      <button id="loNext" class="next" title="Forward one move (→)">→</button>
      <button id="loEnd" title="End of the line">⏭</button>
    </div>
    ${devNote}
    <div class="expl-coursemoves"><span class="hint">Course continue${node && node.moves.size === 1 ? "s" : "s with"}:</span> ${courseMoveBtns}</div>
    ${studyLineHtml([course.id], key)}
    <div class="btnrow lo-tools">
      <button id="loExplorer" title="Open this line in the full line explorer (games, win %, deviation stats)">Open in explorer</button>
    </div>`;

  const el = linesOverlay.el;
  el.querySelector("#loClose").addEventListener("click", closeLinesOverlay);
  el.querySelector("#loStart").addEventListener("click", () => { st.ply = 0; renderLinesOverlay(); });
  el.querySelector("#loPrev").addEventListener("click", () => linesOverlayStep(-1));
  el.querySelector("#loNext").addEventListener("click", () => linesOverlayStep(1));
  el.querySelector("#loEnd").addEventListener("click", () => { st.ply = st.sans.length; renderLinesOverlay(); });
  el.querySelectorAll(".locrumb").forEach((b) => b.addEventListener("click", () => {
    st.ply = +b.dataset.ply;
    renderLinesOverlay();
  }));
  el.querySelectorAll(".lomv").forEach((b) => b.addEventListener("click", () => {
    st.sans = st.sans.slice(0, st.ply);
    st.sans.push(b.dataset.san);
    st.ply = st.sans.length;
    renderLinesOverlay();
  }));
  el.querySelector("#loExplorer").addEventListener("click", () => {
    explState.courseId = course.id;
    explState.sans = st.sans.slice(0, st.ply);
    closeLinesOverlay();
    renderExplorer();
  });
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
    ${studyLineHtml([course.id], key)}
    ${playedRows ? `
    <table class="hist">
      <thead><tr><th>Played here (${userTurn ? "you" : "them"})</th><th>#</th><th>Win</th><th></th></tr></thead>
      <tbody>${playedRows}</tbody>
    </table>` : ""}
    <div class="btnrow expl-tools">
      <button id="explCopyFen" class="igbtn">copy FEN</button>
      <button id="explCopyLine" class="igbtn" ${explState.sans.length ? "" : "disabled"}>copy line</button>
    </div>`;

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
  const copyText = (t, label) => {
    const done = () => onStatus(label + " copied.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => onStatus("Copy failed."));
    else onStatus(label + ": " + t);
  };
  $("explCopyFen").addEventListener("click", () => copyText(fen, "FEN"));
  $("explCopyLine").addEventListener("click", () => copyText(
    explState.sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" "), "Line"));
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
