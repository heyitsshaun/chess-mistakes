/* Piece set manager.
 *
 * "chesscom" is the user's chess.com set (the one their account uses), loaded
 * from chess.com's theme CDN. On first successful load the 12 images are
 * mirrored into IndexedDB as data URLs, so afterwards the set works fully
 * offline. Until then the <img> tags point straight at the CDN.
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
  // Bundled sets ship with the app; remote sets are hotlinked, then cached.
  const BUNDLED = { cburnett: { base: "pieces/cburnett/", ext: ".svg", lower: false } };
  const REMOTE = { chesscom: { base: "https://assets-themes.chess.com/image/ejgfv/150/", ext: ".png", lower: true } };
  const PREF_KEY = "cmt-piece-set";
  const MIG_KEY = "cmt-piece-set-v2"; // one-time default switch to chesscom
  let active = { id: "classic", urls: null };
  const listeners = [];

  const code = (pc) => (pc === pc.toUpperCase() ? "w" : "b") + pc.toUpperCase();
  const notify = () => listeners.forEach((fn) => fn(active.id));

  // Bundled sets are plain relative URLs — the browser caches them like any
  // other asset, so there's nothing to prefetch or mirror into IndexedDB.
  function buildUrls(spec) {
    const urls = {};
    for (const c of CODES) urls[c] = spec.base + (spec.lower ? c.toLowerCase() : c) + spec.ext;
    return urls;
  }

  // Background: mirror a remote set into IndexedDB as data URLs so it keeps
  // working offline. All-or-nothing; any failure just leaves the hotlinks.
  async function mirrorRemote(id, urls) {
    const out = {};
    for (const c of CODES) {
      const resp = await fetch(urls[c]);
      if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + urls[c]);
      const blob = await resp.blob();
      out[c] = await new Promise((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(rd.result);
        rd.onerror = () => reject(new Error("could not read " + urls[c]));
        rd.readAsDataURL(blob);
      });
    }
    await CMT.storage.set("sessions", "pieces-" + id, out);
  }

  async function activate(id) {
    if (id === "classic") {
      active = { id: "classic", urls: null };
    } else if (BUNDLED[id]) {
      active = { id, urls: buildUrls(BUNDLED[id]) };
    } else if (REMOTE[id]) {
      let urls = null;
      try { urls = await CMT.storage.get("sessions", "pieces-" + id); } catch (e) { /* no cache */ }
      if (!urls) {
        urls = buildUrls(REMOTE[id]);
        // Fire-and-forget; next session picks the cache up automatically.
        try { mirrorRemote(id, urls).catch(() => { /* offline — keep hotlinks */ }); } catch (e) { /* no fetch */ }
      }
      active = { id, urls };
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
    let pref = null;
    try {
      pref = localStorage.getItem(PREF_KEY);
      // One-time migration: chesscom is the new default. Anyone still on the
      // old default (cburnett, or nothing) moves over; explicit choices made
      // after this point stick because the flag is set.
      if (!localStorage.getItem(MIG_KEY)) {
        if (!pref || pref === "cburnett") pref = "chesscom";
        localStorage.setItem(MIG_KEY, "1");
      }
    } catch (e) { /* default */ }
    await activate(pref || "chesscom");
  }

  return {
    init, activate, importCustom,
    id: () => active.id,
    url: (pc) => (active.urls ? active.urls[code(pc)] : null),
    onChange: (fn) => listeners.push(fn),
  };
})();
