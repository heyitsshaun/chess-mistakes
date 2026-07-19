/* Piece set manager.
 *
 * "cburnett" is lichess's piece set (GPLv2+), vendored into pieces/cburnett/ —
 * see pieces/cburnett/LICENSE. The files ship with the app, so the set loads
 * offline, on first run, with no network and no CDN. (It used to be fetched
 * from jsDelivr, which silently 403'd — "Package size exceeded the configured
 * limit of 50 MB" — so cburnett could never actually be selected.)
 *
 * "classic" is the built-in geometric fallback drawn inline by app.js.
 * Custom sets are 12 uploaded SVG/PNG files named wK wQ wR wB wN wP
 * bK bQ bR bB bN bP (any extension), stored in IndexedDB.
 */
"use strict";

const Pieces = (() => {
  const CODES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
  const BUNDLED = { cburnett: "pieces/cburnett/" };
  const PREF_KEY = "cmt-piece-set";
  let active = { id: "classic", urls: null };
  const listeners = [];

  const code = (pc) => (pc === pc.toUpperCase() ? "w" : "b") + pc.toUpperCase();
  const notify = () => listeners.forEach((fn) => fn(active.id));

  // Bundled sets are plain relative URLs — the browser caches them like any
  // other asset, so there's nothing to prefetch or mirror into IndexedDB.
  function bundledUrls(id) {
    const base = BUNDLED[id];
    const urls = {};
    for (const c of CODES) urls[c] = base + c + ".svg";
    return urls;
  }

  async function activate(id) {
    if (id === "classic") {
      active = { id: "classic", urls: null };
    } else if (BUNDLED[id]) {
      active = { id, urls: bundledUrls(id) };
    } else {
      // Custom (or anything unknown): only available if it's in IndexedDB.
      const urls = await CMT.storage.get("sessions", "pieces-" + id);
      active = urls ? { id, urls } : { id: "classic", urls: null };
    }
    try { localStorage.setItem(PREF_KEY, active.id); } catch (e) { /* optional */ }
    notify();
    return active.id;
  }

  // files: FileList/array of 12 images named by piece code (wK.svg, bQ.png…).
  async function importCustom(files) {
    const byCode = {};
    for (const f of files) {
      const m = /^([wb][KQRBNP])\./i.exec(f.name);
      if (!m) continue;
      const c = m[1][0].toLowerCase() + m[1][1].toUpperCase();
      byCode[c] = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(rd.result);
        rd.onerror = () => reject(new Error("could not read " + f.name));
        rd.readAsDataURL(f);
      });
    }
    const missing = CODES.filter((c) => !byCode[c]);
    if (missing.length) throw new Error("missing pieces: " + missing.join(", ") + " (name files wK.svg, bQ.png, …)");
    await CMT.storage.set("sessions", "pieces-custom", byCode);
    return activate("custom");
  }

  async function init() {
    let pref = "cburnett";
    try { pref = localStorage.getItem(PREF_KEY) || "cburnett"; } catch (e) { /* default */ }
    await activate(pref);
  }

  return {
    init, activate, importCustom,
    id: () => active.id,
    url: (pc) => (active.urls ? active.urls[code(pc)] : null),
    onChange: (fn) => listeners.push(fn),
  };
})();
