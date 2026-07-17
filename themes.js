/* Chess Mistake Trainer — theme engine.
 * 8 built-in themes + user-defined themes, applied as CSS custom properties on
 * :root so built-ins and custom themes share one code path. Mode model:
 *   prefs.useSystem (default true) → follow prefers-color-scheme live,
 *   mapping light→prefs.lightTheme, dark→prefs.darkTheme.
 *   useSystem off → prefs.manualMode picks which assignment is used.
 * Persistence: localStorage (fast, pre-paint) + CMT.storage mirror under
 * sessions/"themes" (so themes ride along in export/import backups).
 */
"use strict";

const Themes = (function () {
  const LS_PREFS = "cmt-theme-prefs";
  const LS_CUSTOM = "cmt-theme-custom";
  const LS_ACTIVE = "cmt-active-colors"; // consumed by the pre-paint script

  // colors-object key → CSS variable
  const VARMAP = {
    bg: "--bg", surface1: "--surface-1", surface2: "--surface-2", surface3: "--surface-3",
    text: "--text", muted: "--muted", faint: "--faint",
    accent: "--accent", accentSoft: "--accent-soft",
    best: "--best", excellent: "--excellent", good: "--good",
    inacc: "--inacc", mistake: "--mistake", blunder: "--blunder",
    sqLight: "--sq-light", sqDark: "--sq-dark", sqSel: "--sq-sel",
    danger: "--danger", success: "--success", shadow: "--shadow-c",
  };

  // Grade colors are shared per base so grades mean the same thing everywhere:
  // lively on dark, gentle on light.
  const GRADES_DARK = { best: "#34d399", excellent: "#6ee7b7", good: "#a3d977", inacc: "#fbbf24", mistake: "#fb923c", blunder: "#f87171" };
  const GRADES_LIGHT = { best: "#5f9c7e", excellent: "#7fae92", good: "#9db07c", inacc: "#cf9d5f", mistake: "#c97f5d", blunder: "#bf6767" };

  // Fill in derived tokens so every theme object is complete.
  function complete(theme) {
    const c = theme.colors;
    c.accentSoft = c.accent + "33";
    c.danger = c.blunder;
    c.success = c.best;
    c.shadow = theme.base === "dark" ? "rgba(0,0,0,.35)" : "rgba(110,90,80,.14)";
    return theme;
  }

  function mk(id, name, base, colors) {
    return complete({
      id, name, base, builtin: true,
      colors: Object.assign({}, base === "dark" ? GRADES_DARK : GRADES_LIGHT, colors),
    });
  }

  const BUILTINS = [
    mk("midnight", "Midnight Club", "dark", {
      bg: "#0e1116", surface1: "#151a21", surface2: "#1c232d", surface3: "#232c38",
      text: "#e8edf4", muted: "#8d99ab", faint: "#5c6675", accent: "#7aa2f7",
      sqLight: "#aeb9c8", sqDark: "#5c6e85", sqSel: "#f6d76b",
    }),
    mk("forest", "Deep Forest", "dark", {
      bg: "#0f1512", surface1: "#151c17", surface2: "#1b241e", surface3: "#223028",
      text: "#e6ede7", muted: "#8fa396", faint: "#5c6f63", accent: "#7fbf8e",
      sqLight: "#b5c2b0", sqDark: "#5e7261", sqSel: "#e8cf7a",
    }),
    mk("ember", "Charcoal Ember", "dark", {
      bg: "#14110e", surface1: "#1b1713", surface2: "#231d18", surface3: "#2c251e",
      text: "#efe9e2", muted: "#a3968a", faint: "#6f6459", accent: "#e08b5a",
      sqLight: "#c4b6a5", sqDark: "#6e5c4d", sqSel: "#ecc06a",
    }),
    mk("ocean", "Ocean Night", "dark", {
      bg: "#0c1420", surface1: "#111b29", surface2: "#172333", surface3: "#1e2c40",
      text: "#e6edf5", muted: "#8b9bb0", faint: "#5a6a80", accent: "#5ecfc4",
      sqLight: "#a9bccd", sqDark: "#52687f", sqSel: "#ecd27a",
    }),
    mk("blush", "Blush Studio", "light", {
      bg: "#faf6f0", surface1: "#f4eee6", surface2: "#fffdf9", surface3: "#efe6da",
      text: "#3d3733", muted: "#8a7f76", faint: "#b3a89e", accent: "#b56576",
      sqLight: "#f0e4d4", sqDark: "#b79992", sqSel: "#e5c37a",
    }),
    mk("lavender", "Lavender Studio", "light", {
      bg: "#f9f6f2", surface1: "#f1ece5", surface2: "#fefcfa", surface3: "#eae3d9",
      text: "#3b3640", muted: "#877f8a", faint: "#b0a8b2", accent: "#82709f",
      sqLight: "#efe7dc", sqDark: "#a99bb0", sqSel: "#e5c37a",
    }),
    mk("sage", "Sage Morning", "light", {
      bg: "#f6f8f3", surface1: "#edf1e8", surface2: "#fdfefb", surface3: "#e4ebdd",
      text: "#35392f", muted: "#7f8a76", faint: "#a8b29e", accent: "#6e9b7d",
      sqLight: "#eaeddd", sqDark: "#9cab8e", sqSel: "#e5c37a",
    }),
    mk("paper", "Paper & Ink", "light", {
      bg: "#f7f6f3", surface1: "#efede8", surface2: "#fefdfb", surface3: "#e7e4dd",
      text: "#33322f", muted: "#807d76", faint: "#aaa79f", accent: "#5b7290",
      sqLight: "#e8e6df", sqDark: "#9aa0a8", sqSel: "#e5c37a",
    }),
  ];

  const DEFAULT_PREFS = { useSystem: true, lightTheme: "blush", darkTheme: "midnight", manualMode: "dark" };

  let prefs = Object.assign({}, DEFAULT_PREFS);
  let custom = [];
  const listeners = [];
  const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode etc. */ }
  }

  function load() {
    const p = lsGet(LS_PREFS);
    if (p && typeof p === "object") prefs = Object.assign({}, DEFAULT_PREFS, p);
    const c = lsGet(LS_CUSTOM);
    if (Array.isArray(c)) custom = c.map(complete);
  }

  function persist() {
    lsSet(LS_PREFS, prefs);
    lsSet(LS_CUSTOM, custom);
    // Mirror to app storage so backups include themes (fire-and-forget).
    if (typeof CMT !== "undefined") CMT.storage.set("sessions", "themes", { prefs, custom });
  }

  function all() { return BUILTINS.concat(custom); }
  function get(id) { return all().find((t) => t.id === id) || null; }
  function byBase(base) { return all().filter((t) => t.base === base); }

  function mode() {
    if (prefs.useSystem && mq) return mq.matches ? "dark" : "light";
    return prefs.manualMode;
  }

  function active() {
    const m = mode();
    const wanted = m === "dark" ? prefs.darkTheme : prefs.lightTheme;
    return get(wanted) || get(m === "dark" ? "midnight" : "blush") || BUILTINS[0];
  }

  function apply() {
    const theme = active();
    const root = document.documentElement;
    const cache = {};
    for (const key in VARMAP) {
      const v = theme.colors[key];
      if (v) { root.style.setProperty(VARMAP[key], v); cache[VARMAP[key]] = v; }
    }
    root.dataset.base = theme.base; // lets CSS gate glow (dark) vs shadow (light)
    lsSet(LS_ACTIVE, cache);
    for (const fn of listeners) fn(theme, mode());
    return theme;
  }

  function setPrefs(patch) {
    Object.assign(prefs, patch);
    persist();
    apply();
  }

  // Toggle = explicit choice, so system-follow turns off.
  function toggleMode() {
    setPrefs({ useSystem: false, manualMode: mode() === "dark" ? "light" : "dark" });
  }

  function duplicate(id) {
    const src = get(id);
    if (!src) return null;
    const copy = complete({
      id: "custom-" + Date.now(),
      name: src.name + " (copy)",
      base: src.base,
      builtin: false,
      colors: Object.assign({}, src.colors),
    });
    custom.push(copy);
    persist();
    return copy;
  }

  function saveCustom(theme) {
    complete(theme);
    const i = custom.findIndex((t) => t.id === theme.id);
    if (i >= 0) custom[i] = theme; else custom.push(theme);
    persist();
    apply();
  }

  function deleteCustom(id) {
    custom = custom.filter((t) => t.id !== id);
    // Repoint any assignment that referenced the deleted theme.
    if (prefs.lightTheme === id) prefs.lightTheme = "blush";
    if (prefs.darkTheme === id) prefs.darkTheme = "midnight";
    persist();
    apply();
  }

  // Restore from an imported backup ({prefs, custom}).
  function importData(data) {
    if (!data || typeof data !== "object") return;
    if (data.prefs) prefs = Object.assign({}, DEFAULT_PREFS, data.prefs);
    if (Array.isArray(data.custom)) custom = data.custom.map(complete);
    persist();
    apply();
  }

  function onChange(fn) { listeners.push(fn); }

  if (mq && mq.addEventListener) {
    mq.addEventListener("change", () => { if (prefs.useSystem) apply(); });
  }

  load();

  return {
    all, get, byBase, mode, active, apply, setPrefs, toggleMode,
    duplicate, saveCustom, deleteCustom, importData, onChange,
    prefs: () => Object.assign({}, prefs),
    data: () => ({ prefs: Object.assign({}, prefs), custom: custom.slice() }),
    VARMAP,
  };
})();
