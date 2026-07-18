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
  "app.js",
].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n") + `
;window.__hooks = {
  renderList, retryMove, openDrillSetup, startDrill, exitDrillNow, setMode,
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
  function mkGame(sans, white, black) {
    const moves = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
    return {
      pgn: `[Event "Live Chess"]\n[White "${white}"]\n[Black "${black}"]\n\n${moves} *`,
      rules: "chess", url: "https://chess.com/game/1",
      white: { username: white }, black: { username: black },
    };
  }
  const games = [
    mkGame(["e4", "b5"], "opp", "tester"),            // I deviate (course: e6)
    mkGame(["e4", "b5"], "opp", "tester"),            // same deviation again
    mkGame(["e4", "e6", "Qh5", "Nf6"], "opp", "tester"), // opponent deviates (Qh5 not in course)
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
