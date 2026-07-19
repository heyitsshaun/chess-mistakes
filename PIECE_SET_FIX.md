# Piece set selection — root cause and fix

## Symptom
Changing "Chess pieces" in Settings did nothing. The board kept rendering the
built-in classic pieces no matter what was selected.

## Root cause: the cburnett CDN URL was silently 403ing

`pieces.js` fetched the lichess cburnett set from:

```
https://cdn.jsdelivr.net/gh/lichess-org/lila/public/piece/cburnett/wK.svg
```

That URL returns **403**, body:

```
Package size exceeded the configured limit of 50 MB.
```

jsDelivr's `/gh/` endpoint refuses to serve `lichess-org/lila` without an
explicit ref, because resolving the whole default branch blows its size limit.

`activate()` caught the failure and fell back to classic:

```javascript
try { urls = await fetchCburnett(); } catch (e) { urls = null; }
active = urls ? { id, urls } : { id: "classic", urls: null };
```

So *every* attempt to select cburnett — online or off, first run or hundredth —
landed on classic. The board never changed because the pieces never loaded.
Nothing in the storage/load/render chain was broken; it was starved of assets.

Verified against the old code with the network disabled:

```
activate() returned : classic
Pieces.id()         : classic
Pieces.url(K)       : null
localStorage        : cburnett      <- disagrees with what's rendering
=> board renders    : CLASSIC (unchanged!)
```

## Fix: bundle the pieces, drop the CDN

The 12 cburnett SVGs (~7.5 KB total) are now vendored in `pieces/cburnett/`
and referenced as plain relative URLs:

```javascript
const BUNDLED = { cburnett: "pieces/cburnett/" };
function bundledUrls(id) {
  const base = BUNDLED[id];
  const urls = {};
  for (const c of CODES) urls[c] = base + c + ".svg";
  return urls;
}
```

This removes the whole failure mode: no fetch, no CDN, no offline-first-run
fallback, and no IndexedDB mirroring for the built-in set. The browser caches
the SVGs like any other static asset.

`pieces/cburnett/LICENSE` carries the GPLv2+ notice for the artwork
(Colin M.L. Burnett, via lichess-org/lila).

## Secondary fix: localStorage recorded intent, not reality

`activate()` persisted the *requested* id rather than the one that actually
became active:

```javascript
- try { localStorage.setItem(PREF_KEY, id); }
+ try { localStorage.setItem(PREF_KEY, active.id); }
```

Previously a failed selection left localStorage saying `cburnett` while the
board rendered classic, so the dropdown reported a set that wasn't in use.
`app.js` had a workaround for this that read the stale preference back; that
workaround is gone, and the dropdown now just mirrors `Pieces.id()`.

This still matters after bundling: selecting **Custom** with no uploaded files
falls back to classic, and that fallback is now recorded honestly.

## Tests

`test/pieces.test.js` (wired into `npm test`) runs with `fetch` throwing, which
is the point — bundled assets must work with no network:

- all 12 SVGs exist, are well-formed, and carry `xmlns` (required for `<img src>`)
- `activate('cburnett')` returns `cburnett` offline, with URLs pointing at the bundled paths
- the selection is persisted, and `init()` reads it back after a reload
- `onChange` fires, and rendered markup references the selected set's file
- Custom-with-no-files falls back to classic *and* records classic

The old implementation fails these; the reproduction above is what they pin down.

## Files changed
- `pieces.js` — bundled loader replaces CDN fetch; persist `active.id`
- `app.js` — dropdown mirrors `Pieces.id()`; dead "couldn't fetch" branch removed
- `pieces/cburnett/*.svg` — 12 vendored piece SVGs (new)
- `pieces/cburnett/LICENSE` — GPLv2+ notice (new)
- `test/pieces.test.js` — regression tests (new)
- `package.json` — test script runs the new suite
