/* Piece set manager. Default is lichess's cburnett set (GPL, from the
 * lichess-org/lila repo via jsDelivr), fetched once and cached in IndexedDB
 * as data URLs so later loads work offline. "Classic" is the built-in
 * geometric fallback (also used automatically if the first fetch fails).
 * Custom sets are 12 uploaded SVG/PNG files named wK wQ wR wB wN wP
 * bK bQ bR bB bN bP (any extension).
 */
"use strict";

const Pieces = (() => {
  const CODES = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
  const CDN = "https://cdn.jsdelivr.net/gh/lichess-org/lila/public/piece/cburnett/";
  const PREF_KEY = "cmt-piece-set";
  let active = { id: "classic", urls: null };
  const listeners = [];

  const code = (pc) => (pc === pc.toUpperCase() ? "w" : "b") + pc.toUpperCase();
  const notify = () => listeners.forEach((fn) => fn(active.id));

  async function fetchCburnett() {
    const urls = {};
    await Promise.all(CODES.map(async (c) => {
      const r = await fetch(CDN + c + ".svg");
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + c);
      const text = await r.text();
      urls[c] = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(text)));
    }));
    return urls;
  }

  async function activate(id) {
    if (id === "classic") {
      active = { id: "classic", urls: null };
    } else {
      let urls = await CMT.storage.get("sessions", "pieces-" + id);
      if (!urls && id === "cburnett") {
        try {
          urls = await fetchCburnett();
          CMT.storage.set("sessions", "pieces-cburnett", urls);
        } catch (e) { urls = null; /* offline first run → classic fallback */ }
      }
      active = urls ? { id, urls } : { id: "classic", urls: null };
    }
    try { localStorage.setItem(PREF_KEY, id); } catch (e) { /* optional */ }
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
