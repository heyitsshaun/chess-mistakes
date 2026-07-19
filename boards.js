/* Board (square colors) manager — a setting of its own, separate from themes.
 *
 * Every theme still ships square colors, and "Theme colors" follows them.
 * Any other board overrides --sq-light / --sq-dark / --sq-sel on :root after
 * each theme apply (Themes.onChange), and patches the cmt-active-colors
 * pre-paint cache so reloads never flash the theme's own board first.
 *
 * "chesscom" matches chess.com's brown board (the one the user plays on).
 * Custom boards are named {sqLight, sqDark, sqSel} triples in localStorage,
 * mirrored to CMT.storage under sessions/"boards" for export/import backups.
 */
"use strict";

const Boards = (function () {
  const LS_PREF = "cmt-board";
  const LS_CUSTOM = "cmt-board-custom";
  const LS_ACTIVE = "cmt-active-colors"; // shared with themes.js pre-paint
  const VARS = { sqLight: "--sq-light", sqDark: "--sq-dark", sqSel: "--sq-sel" };

  const BUILTINS = [
    { id: "theme", name: "Theme colors", builtin: true, colors: null },
    { id: "chesscom", name: "Chess.com (brown)", builtin: true,
      colors: { sqLight: "#edd6b0", sqDark: "#b88762", sqSel: "#f6ea71" } },
  ];
  const DEFAULT_ID = "chesscom";

  let activeId = DEFAULT_ID;
  let custom = [];
  const listeners = [];

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode etc. */ }
  }

  function all() { return BUILTINS.concat(custom); }
  function get(id) { return all().find((b) => b.id === id) || null; }
  function active() { return get(activeId) || get(DEFAULT_ID); }

  // colors: the square colors currently in effect (board's own, or the theme's).
  function colors() {
    const b = active();
    if (b.colors) return b.colors;
    const t = typeof Themes !== "undefined" ? Themes.active() : null;
    return t ? { sqLight: t.colors.sqLight, sqDark: t.colors.sqDark, sqSel: t.colors.sqSel } : {};
  }

  function apply() {
    const c = colors();
    const root = document.documentElement;
    const cache = lsGet(LS_ACTIVE) || {};
    for (const key in VARS) {
      if (c[key]) { root.style.setProperty(VARS[key], c[key]); cache[VARS[key]] = c[key]; }
    }
    lsSet(LS_ACTIVE, cache);
    for (const fn of listeners) fn(active());
    return active();
  }

  function data() { return { activeId, custom: custom.slice() }; }

  function persist() {
    lsSet(LS_PREF, activeId);
    lsSet(LS_CUSTOM, custom);
    if (typeof CMT !== "undefined") CMT.storage.set("sessions", "boards", data());
  }

  function activate(id) {
    activeId = get(id) ? id : DEFAULT_ID;
    persist();
    apply();
    return activeId;
  }

  // New custom board, seeded from whatever is currently on screen.
  function create() {
    const c = colors();
    const board = {
      id: "board-" + Date.now(),
      name: "My board",
      builtin: false,
      colors: {
        sqLight: c.sqLight || "#edd6b0",
        sqDark: c.sqDark || "#b88762",
        sqSel: c.sqSel || "#f6ea71",
      },
    };
    custom.push(board);
    persist();
    return board;
  }

  function save(board) {
    const i = custom.findIndex((b) => b.id === board.id);
    if (i >= 0) custom[i] = board; else custom.push(board);
    persist();
    if (board.id === activeId) apply();
  }

  function remove(id) {
    custom = custom.filter((b) => b.id !== id);
    if (activeId === id) activeId = DEFAULT_ID;
    persist();
    apply();
  }

  // Restore from an imported backup ({activeId, custom}).
  function importData(data) {
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.custom)) custom = data.custom.filter((b) => b && b.id && b.colors);
    if (typeof data.activeId === "string" && get(data.activeId)) activeId = data.activeId;
    persist();
    apply();
  }

  function onChange(fn) { listeners.push(fn); }

  function init() {
    const c = lsGet(LS_CUSTOM);
    if (Array.isArray(c)) custom = c.filter((b) => b && b.id && b.colors);
    const p = lsGet(LS_PREF);
    if (typeof p === "string" && get(p)) activeId = p;
    // Re-assert the override every time a theme (re)applies its colors.
    if (typeof Themes !== "undefined") Themes.onChange(() => { if (active().colors) apply(); });
    apply();
  }

  return {
    init, all, get, active, colors, apply, activate, create, save, remove,
    importData, onChange, data,
    id: () => activeId,
  };
})();
