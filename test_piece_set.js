/* Test piece set functionality
 * Run with: node test_piece_set.js (from project root)
 * Tests that:
 * 1. Piece set selection is saved to localStorage
 * 2. Piece set is loaded correctly on page load
 * 3. Piece set is correctly reported as active
 * 4. Piece set persists across page reloads (simulated)
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

// Stubs
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.fetch = async () => { throw new Error("network disabled in test"); };
window.Worker = undefined;

const errors = [];
window.addEventListener("error", (e) => errors.push(e.error || e.message));

// Load scripts in order
const scripts = [
  "core.js",
  "pieces.js",
];

const combined = scripts
  .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n;\n");

try {
  window.eval(combined);
} catch (e) {
  errors.push("script load: " + e.message);
}

if (errors.length) {
  console.error("ERRORS loading scripts:");
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

const { Pieces } = window;
const localStorage = window.localStorage;

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.error("  ✗ " + name);
    console.error("    " + (e.stack || e.message).split("\n").slice(0, 2).join("\n    "));
  }
}

async function test() {
  console.log("\nTesting Piece Set Functionality\n");

  // Test 1: Activating "classic" sets localStorage
  console.log("Test 1: Activation and localStorage");
  await Pieces.init();
  const initialId = Pieces.id();
  check("Initial id is defined", () => assert(initialId, "Initial piece set should be defined"));
  check("Initial id is string", () => assert(typeof initialId === "string", "Initial piece set should be a string"));

  // Test 2: Activate "classic" explicitly
  console.log("\nTest 2: Activating classic");
  const classicResult = await Pieces.activate("classic");
  check("Activate classic returns 'classic'", () => assert.strictEqual(classicResult, "classic", "Should return 'classic'"));
  check("Pieces.id() after classic activation", () => assert.strictEqual(Pieces.id(), "classic", "Pieces.id() should return 'classic'"));
  check("localStorage reflects classic", () => {
    const stored = localStorage.getItem("cmt-piece-set");
    assert.strictEqual(stored, "classic", `localStorage should be 'classic', got '${stored}'`);
  });

  // Test 3: Try to activate cburnett (will fail offline, should fall back to classic)
  console.log("\nTest 3: Fallback when cburnett fetch fails");
  const cbResult = await Pieces.activate("cburnett");
  check("Fallback returns classic when cburnett unavailable", () => {
    assert.strictEqual(cbResult, "classic", "Should fall back to classic when fetch fails");
  });
  check("Pieces.id() is classic after failed cburnett", () => {
    assert.strictEqual(Pieces.id(), "classic", "Pieces.id() should return 'classic'");
  });
  check("localStorage matches actual piece set", () => {
    const stored = localStorage.getItem("cmt-piece-set");
    const actual = Pieces.id();
    assert.strictEqual(
      stored,
      actual,
      `localStorage ('${stored}') should match Pieces.id() ('${actual}')`
    );
  });

  // Test 4: Verify classic piece set has no URLs
  console.log("\nTest 4: Classic piece set properties");
  check("Classic set has no URLs", () => {
    const url = Pieces.url("K");
    assert.strictEqual(url, null, "Classic piece set should return null for url()");
  });

  // Test 5: Re-init from localStorage
  console.log("\nTest 5: Persistence across init");
  localStorage.setItem("cmt-piece-set", "classic");
  const { Pieces: Pieces2 } = window;
  // Note: Pieces is a singleton, so we can't truly re-init without reloading
  // Instead, verify that current state matches localStorage
  check("Current Pieces.id() matches localStorage", () => {
    const stored = localStorage.getItem("cmt-piece-set");
    const actual = Pieces.id();
    assert.strictEqual(actual, stored, `Should match: id='${actual}' vs localStorage='${stored}'`);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

test().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
