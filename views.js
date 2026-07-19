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
