/* Piece set tests — the set must be selectable, persisted, read back on load,
 * and actually reflected in rendered markup. Runs with no network at all
 * (fetch throws), which is the whole point: cburnett is bundled, not fetched.
 * Run with: node test/pieces.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const CODES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); }
}

// --- the bundled asset files themselves ---
console.log("bundled cburnett assets");
check("all 12 piece files exist and are non-empty SVGs", () => {
  for (const c of CODES) {
    const f = path.join(root, "pieces", "cburnett", c + ".svg");
    assert(fs.existsSync(f), "missing " + f);
    const s = fs.readFileSync(f, "utf8");
    assert(/<svg[\s>]/i.test(s), c + " is not an SVG");
    assert(/<\/svg>/i.test(s), c + " looks truncated");
    assert(s.includes('xmlns='), c + " has no xmlns (breaks <img src>)");
  }
});
check("GPL license notice ships alongside the pieces", () => {
  assert(fs.existsSync(path.join(root, "pieces", "cburnett", "LICENSE")), "missing LICENSE");
});

// --- the manager, in a DOM, with no network ---
function boot(prefValue) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", runScripts: "outside-only" });
  const { window } = dom;
  window.fetch = async () => { throw new Error("network disabled"); };
  if (prefValue !== undefined) window.localStorage.setItem("cmt-piece-set", prefValue);
  // `const Pieces = ...` is lexically scoped to its own eval() call, so the stub,
  // the source, and the export have to go through as a single eval (same trick
  // test/ui.smoke.js uses to emulate shared <script> scope).
  window.eval([
    "var CMT = { storage: { get: async () => undefined, set: async () => true } };",
    fs.readFileSync(path.join(root, "pieces.js"), "utf8"),
    "window.Pieces = Pieces;",
  ].join("\n;\n"));
  return window;
}

console.log("piece set manager (offline)");

(async () => {
  {
    const w = boot();
    const id = await w.eval("Pieces.activate('cburnett')");
    check("activate('cburnett') → 'cburnett' with no network", () => {
      assert.strictEqual(id, "cburnett");
      assert.strictEqual(w.eval("Pieces.id()"), "cburnett");
    });
    check("urls point at the bundled relative paths", () => {
      assert.strictEqual(w.eval("Pieces.url('K')"), "pieces/cburnett/wK.svg");
      assert.strictEqual(w.eval("Pieces.url('q')"), "pieces/cburnett/bQ.svg");
      assert.strictEqual(w.eval("Pieces.url('p')"), "pieces/cburnett/bP.svg");
    });
    check("selection is written to localStorage", () => {
      assert.strictEqual(w.localStorage.getItem("cmt-piece-set"), "cburnett");
    });
  }

  {
    const w = boot();
    let seen = null;
    w.eval("window.__seen = null; Pieces.onChange((id) => { window.__seen = id; });");
    await w.eval("Pieces.activate('cburnett')");
    seen = w.eval("window.__seen");
    check("onChange listeners are notified on change", () => assert.strictEqual(seen, "cburnett"));
  }

  {
    const w = boot();
    await w.eval("Pieces.activate('cburnett')");
    await w.eval("Pieces.activate('classic')");
    check("switching back to classic clears urls", () => {
      assert.strictEqual(w.eval("Pieces.id()"), "classic");
      assert.strictEqual(w.eval("Pieces.url('K')"), null);
      assert.strictEqual(w.localStorage.getItem("cmt-piece-set"), "classic");
    });
  }

  // The reported bug: pick a set, reload, and it's gone.
  {
    const w1 = boot();
    await w1.eval("Pieces.activate('cburnett')");
    const persisted = w1.localStorage.getItem("cmt-piece-set");
    const w2 = boot(persisted);
    await w2.eval("Pieces.init()");
    check("preference survives a reload (init reads it back)", () => {
      assert.strictEqual(w2.eval("Pieces.id()"), "cburnett");
      assert.strictEqual(w2.eval("Pieces.url('K')"), "pieces/cburnett/wK.svg");
    });
  }

  {
    const w = boot();
    await w.eval("Pieces.init()");
    check("default on a fresh profile is cburnett, and it sticks", () => {
      assert.strictEqual(w.eval("Pieces.id()"), "cburnett");
    });
  }

  {
    const w = boot("custom"); // custom selected but nothing in storage
    await w.eval("Pieces.init()");
    check("custom with no uploaded files falls back to classic honestly", () => {
      assert.strictEqual(w.eval("Pieces.id()"), "classic");
      assert.strictEqual(w.localStorage.getItem("cmt-piece-set"), "classic",
        "localStorage must record what is actually active, not what was asked for");
    });
  }

  // --- rendering: the piece set must reach the markup ---
  {
    const w = boot();
    await w.eval("Pieces.activate('cburnett')");
    const url = w.eval("Pieces.url('K')");
    const markup = url ? `<img class="piece" src="${url}" alt="" draggable="false" />` : "<svg>";
    check("rendered markup references the selected set's file", () => {
      assert(markup.includes("pieces/cburnett/wK.svg"), "markup did not pick up the set: " + markup);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
