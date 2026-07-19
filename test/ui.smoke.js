/* UI smoke test — loads index.html + all scripts in jsdom, boots the app,
 * runs a repertoire analysis on synthetic games, and exercises list render,
 * detail panels, mode toggle, and drill start. Catches wiring/runtime errors
 * that the core suite can't see. Run with: node test/ui.smoke.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// --- stubs jsdom doesn't provide ---
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.fetch = async () => { throw new Error("network disabled in smoke test"); };
window.Worker = undefined;

const errors = [];
window.addEventListener("error", (e) => errors.push(e.error || e.message));

// Classic <script> tags share top-level lexical scope; separate eval() calls
// don't. Concatenate everything into one eval and expose test hooks.
const combined = [
  "node_modules/chess.js/chess.js",
  "courses-data.js",
  "core.js",
  "themes.js",
  "pieces.js",
  "app.js",
].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + `
;window.__hooks = {
  renderList, retryMove, openDrillSetup, startDrill, exitDrillNow, setMode,
  setGameIndex, openExplorer,
  setLastRep: (r) => { lastRep = r; },
  getState: () => ({ appMode, lastRep, lastResults, currentPos }),
};`;
try { window.eval(combined); } catch (e) { errors.push("script load: " + e.message); }

const assert = require("assert");
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); }
}

(async () => {
  const doc = window.document;
  const CMT = window.CMT;

  // Boot the app.
  doc.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  check("app boots without errors", () => {
    assert.deepStrictEqual(errors, []);
  });

  check("bundled courses registered (5 from courses-data.js)", () => {
    assert.strictEqual(CMT.activeCourses().length, 5);
    const colors = CMT.activeCourses().map((c) => c.color).sort().join("");
    assert.strictEqual(colors, "bbbww");
  });

  check("course manager renders rows", () => {
    assert.strictEqual(doc.querySelectorAll("#courseList .cbrow").length, 5);
  });

  check("mode defaults to repertoire", () => {
    assert.ok(doc.getElementById("modeRep").classList.contains("active"));
    assert.ok(!doc.body.classList.contains("mode-legacy"));
  });

  // Synthetic games against the real Owen's Defense course (color b):
  // course expects 1.e4 e6; as black, play 1...b5 = user-dev. As white vs
  // London-ish… keep it simple: two user-devs + one opp-dev.
  function mkGame(sans, white, black, result) {
    const moves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
    return {
      pgn: `[Event "Live Chess"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${result || "*"}"]\n[Date "2026.07.01"]\n\n${moves} ${result || "*"}`,
      rules: "chess", url: "https://chess.com/game/1",
      white: { username: white }, black: { username: black },
    };
  }
  const games = [
    mkGame(["e4", "b5"], "opp", "tester", "1-0"),            // I deviate (course: e6); loss
    mkGame(["e4", "b5"], "opp", "tester", "0-1"),            // same deviation; win
    mkGame(["e4", "e6", "Qh5", "Nf6"], "opp", "tester", "0-1"), // opponent deviates (Qh5); win
  ];
  const fakeEngine = { cache: new Map(), evaluate: async () => ({ cp: 0, mate: null, best: "g8f6" }) };

  let rep;
  await (async () => {
    const s = { username: "tester", windowSize: 3, depth: 12,
      th: { Best: 10, Excellent: 25, Good: 50, Inaccuracy: 100, Mistake: 200 },
      phases: { openEnd: 8, midEnd: 25, accOpen: 1, accMid: 2, accEnd: 3 },
      flagShare: 0.5, minOcc: 1 };
    rep = await CMT.runRepertoireAnalysis(games, s, { getEngine: async () => fakeEngine });
  })();

  check("repertoire analysis on real bundled course", () => {
    assert.strictEqual(rep.counts.userDev, 2);
    assert.strictEqual(rep.counts.oppDev, 1);
    assert.strictEqual(rep.userDev.length, 1);
    assert.strictEqual(rep.userDev[0].plays[0].san, "b5");
    assert.ok(rep.userDev[0].expected.some((e) => e.san === "e6"));
    assert.strictEqual(rep.oppDev[0].theirMove.san, "Qh5");
    assert.strictEqual(rep.oppDev[0].positions.length, 1); // my one reply Nf6 graded
  });

  // Inject results into the app and render. The opp-dev group has clean
  // engine grades (fake engine), so it's only visible with "show all".
  const H = window.__hooks;
  H.setLastRep(rep);
  H.setGameIndex(CMT.buildGameIndex(games, "tester"));
  doc.getElementById("showAll").checked = true;
  H.renderList();

  check("repertoire list renders both card kinds", () => {
    const cards = doc.querySelectorAll("#results .card");
    assert.strictEqual(cards.length, 2);
    const text = doc.getElementById("results").textContent;
    assert.ok(text.includes("I deviated"));
    assert.ok(text.includes("They deviated"));
    assert.ok(text.includes("Owen"));
  });

  check("deviation filter narrows the list", () => {
    doc.getElementById("devFilter").value = "user";
    H.renderList();
    assert.strictEqual(doc.querySelectorAll("#results .card").length, 1);
    doc.getElementById("devFilter").value = "all";
    H.renderList();
  });

  check("user-dev detail panel renders and accepts course-move retry", () => {
    const card = doc.querySelectorAll("#results .card")[0];
    card.click();
    const detail = doc.getElementById("detail").textContent;
    assert.ok(detail.includes("course"));
    assert.ok(doc.getElementById("board"));
    // Simulate the correct course move e7e6 via the retry path.
    H.retryMove("e7", "e6");
    const fb = doc.getElementById("feedback").textContent;
    assert.ok(fb.includes("course move"), "feedback was: " + fb);
  });

  check("opp-dev detail panel renders window table", () => {
    const cards = [...doc.querySelectorAll("#results .card")];
    const oppCard = cards.find((c) => c.textContent.includes("They deviated"));
    oppCard.click();
    const detail = doc.getElementById("detail").textContent;
    assert.ok(detail.includes("Qh5"));
    assert.ok(doc.querySelector(".wrow"), "window rows missing");
    doc.querySelector(".wrow").click(); // opens the window position panel
    assert.ok(doc.getElementById("detail").textContent.includes("After"));
  });

  check("drill starts from repertoire pool", () => {
    H.openDrillSetup();
    assert.strictEqual(doc.getElementById("drillSetup").hidden, false);
    H.startDrill();
    assert.ok(doc.body.classList.contains("drill-active"));
    const detail = doc.getElementById("detail").textContent;
    assert.ok(detail.includes("Position 1 of"));
    H.exitDrillNow();
  });

  check("win % + games drill-down + game viewer round trip", () => {
    // open the user-dev card again
    const card = [...doc.querySelectorAll("#results .card")].find((c) => c.textContent.includes("I deviated"));
    card.click();
    const detail = doc.getElementById("detail");
    assert.ok(detail.querySelector(".win"), "win % cell missing");
    assert.ok(detail.textContent.includes("50%"), "b5 win % should be 50% (1W 1L)");
    // drill into the games for b5
    detail.querySelector(".gbtn").click();
    assert.ok(detail.textContent.includes("Games where you played b5"));
    assert.strictEqual(detail.querySelectorAll(".grow").length, 2);
    assert.ok(detail.querySelector(".resbadge.resW") && detail.querySelector(".resbadge.resL"));
    // open a game, check the move strip, and navigate back up
    detail.querySelector(".grow").click();
    assert.ok(detail.querySelector("#gvMoves"), "game viewer missing");
    assert.strictEqual(detail.querySelectorAll("#gvMoves .mv").length, 2); // e4 b5
    doc.getElementById("gvBack").click();
    assert.ok(detail.textContent.includes("Games where you played b5"), "back to games list failed");
    doc.getElementById("glBack").click();
    assert.ok(detail.textContent.includes("course"), "back to position panel failed");
  });

  check("line explorer walks the course with stats + deviation %", () => {
    H.openExplorer();
    const detail = doc.getElementById("detail");
    assert.ok(detail.textContent.includes("Line explorer"));
    assert.ok(detail.querySelector(".explmv"), "course move buttons missing");
    assert.ok(detail.textContent.includes("Reached in 3 games"), "root stats wrong: " + detail.querySelector(".expl-stats").textContent.trim());
    // step into 1.e4 — Owen's expects e6; I played b5 twice, e6 once
    const e4 = [...detail.querySelectorAll(".explmv")].find((b) => b.textContent.trim().startsWith("e4"));
    e4.click();
    assert.ok(detail.textContent.includes("You deviate from the line when playing this position"), "deviation line missing");
    assert.ok(detail.textContent.includes("67%"), "expected 67% deviation (2 of 3)");
    assert.ok(detail.textContent.includes("Reached in 3 games"));
    // games from here, then back to the explorer at the same node
    doc.getElementById("explGames").click();
    assert.ok(detail.textContent.includes("Games reaching this position"));
    doc.getElementById("glBack").click();
    assert.ok(detail.textContent.includes("Line explorer"), "back to explorer failed");
    assert.ok(detail.querySelector(".crumb"), "move path breadcrumb missing");
    doc.getElementById("explClose").click();
  });

  check("summary strip, course filter, intentional marking present", () => {
    H.renderList();
    assert.ok(doc.querySelector(".rep-summary"), "summary strip missing");
    assert.ok(doc.querySelector(".rep-summary").textContent.includes("3"), "games count missing");
    const cf = doc.getElementById("courseFilter");
    assert.strictEqual(cf.options.length, 6, "expected All + 5 courses");
    // course filter narrows to Owen's-only deviations (all of ours are)
    cf.value = [...cf.options].find((o) => o.textContent.includes("Owen")).value;
    H.renderList();
    assert.ok(doc.querySelectorAll("#results .card").length >= 1);
    cf.value = "all";
    H.renderList();
    // intentional button exists on user-dev panel
    [...doc.querySelectorAll("#results .card")].find((c) => c.textContent.includes("I deviated")).click();
    assert.ok(doc.querySelector(".devig"), "intentional button missing");
  });

  check("legacy mode toggle keeps working", () => {
    doc.getElementById("modeLegacy").click();
    assert.ok(doc.body.classList.contains("mode-legacy"));
    assert.ok(doc.getElementById("results").textContent.includes("keep getting wrong"));
    doc.getElementById("modeRep").click();
    assert.ok(!doc.body.classList.contains("mode-legacy"));
  });

  check("no runtime errors accumulated", () => {
    assert.deepStrictEqual(errors, []);
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
