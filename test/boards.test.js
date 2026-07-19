/* Board setting tests — the board is its own setting layered over themes:
 * default is the chess.com brown board, "theme" follows the active theme's
 * square colors, custom boards persist and survive a reload, and the
 * pre-paint cache (cmt-active-colors) always ends up with the board's colors
 * so reloads don't flash. Run with: node test/boards.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + "\n      " + (e.stack || e.message).split("\n").slice(0, 3).join("\n      ")); }
}

function boot(seedLocalStorage) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", runScripts: "outside-only" });
  const { window } = dom;
  window.matchMedia = () => ({ matches: true, addEventListener: () => {} }); // dark
  if (seedLocalStorage) for (const k in seedLocalStorage) window.localStorage.setItem(k, seedLocalStorage[k]);
  window.eval([
    "var CMT = { storage: { get: async () => undefined, set: async () => true } };",
    fs.readFileSync(path.join(root, "themes.js"), "utf8"),
    fs.readFileSync(path.join(root, "boards.js"), "utf8"),
    "window.Themes = Themes; window.Boards = Boards;",
    "Themes.apply(); Boards.init();",
  ].join("\n;\n"));
  return window;
}

const sq = (w, name) => w.document.documentElement.style.getPropertyValue(name);

console.log("board setting");

{
  const w = boot();
  check("default board is chess.com brown, overriding the theme", () => {
    assert.strictEqual(w.eval("Boards.id()"), "chesscom");
    assert.strictEqual(sq(w, "--sq-light"), "#edd6b0");
    assert.strictEqual(sq(w, "--sq-dark"), "#b88762");
    assert.strictEqual(sq(w, "--sq-sel"), "#f6ea71");
  });
  check("pre-paint cache carries the board override", () => {
    const cache = JSON.parse(w.localStorage.getItem("cmt-active-colors"));
    assert.strictEqual(cache["--sq-light"], "#edd6b0");
    assert.strictEqual(cache["--sq-dark"], "#b88762");
  });
  check("'theme' board follows the active theme's squares", () => {
    w.eval("Boards.activate('theme')");
    const t = w.eval("Themes.active()");
    assert.strictEqual(sq(w, "--sq-light"), t.colors.sqLight);
    assert.strictEqual(sq(w, "--sq-dark"), t.colors.sqDark);
  });
  check("board override re-asserts after a theme re-apply", () => {
    w.eval("Boards.activate('chesscom'); Themes.apply();");
    assert.strictEqual(sq(w, "--sq-light"), "#edd6b0");
  });
}

{
  const w = boot();
  w.eval("var b = Boards.create(); b.name = 'Test board'; b.colors.sqDark = '#123456'; Boards.save(b); Boards.activate(b.id);");
  check("custom board can be created, edited, and activated", () => {
    assert.strictEqual(sq(w, "--sq-dark"), "#123456");
    assert.strictEqual(w.eval("Boards.active().name"), "Test board");
  });
  const seed = {
    "cmt-board": w.localStorage.getItem("cmt-board"),
    "cmt-board-custom": w.localStorage.getItem("cmt-board-custom"),
  };
  const w2 = boot(seed);
  check("custom board and selection survive a reload", () => {
    assert.strictEqual(w2.eval("Boards.active().name"), "Test board");
    assert.strictEqual(sq(w2, "--sq-dark"), "#123456");
  });
  w.eval("Boards.remove(Boards.id())");
  check("removing the active custom board falls back to chesscom", () => {
    assert.strictEqual(w.eval("Boards.id()"), "chesscom");
    assert.strictEqual(sq(w, "--sq-dark"), "#b88762");
  });
}

{
  const w = boot();
  w.eval("Boards.importData({ activeId: 'theme', custom: [{ id: 'board-1', name: 'Imported', builtin: false, colors: { sqLight: '#ffffff', sqDark: '#000000', sqSel: '#ff0000' } }] })");
  check("importData restores custom boards and the selection", () => {
    assert.strictEqual(w.eval("Boards.id()"), "theme");
    assert.strictEqual(w.eval("Boards.get('board-1').name"), "Imported");
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
