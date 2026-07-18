/**
 * Chessly course crawler — extracts the full move tree of a course you own.
 *
 * HOW TO RUN (no agent needed):
 *   1. In Chrome, log into chessly.com and open the course page:
 *      https://chessly.com/courses/<COURSE_ID>
 *   2. Open DevTools (Cmd+Opt+J) > Console, paste this whole file, press Enter.
 *   3. Wait. Progress logs every few seconds. When done it auto-downloads
 *      chessly-<course>-raw.json to your Downloads folder.
 *   4. Convert with: python3 chessly_to_pgn.py <that file>
 *
 * Also works via an agent driving Chrome's javascript tool — see TASK-SPEC.md.
 */
(async () => {
  // course id from URL, or hardcode it here:
  const courseId = location.pathname.match(/courses\/([0-9a-f-]+)/)?.[1];
  if (!courseId) { console.error('Open a chessly.com/courses/<id> page first'); return; }

  const { Chess } = await import('https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm');
  const base = `https://cag.chessly.com/beta/openings/courses/${courseId}/positions/studies?fen=`;
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Chessly stores FENs with the en-passant square ALWAYS set after a double
  // pawn push (old-style). chess.js omits it unless capturable, so patch it.
  // The API is an exact-FEN match — wrong ep field returns empty moves.
  function childFen(fen, san) {
    const c = new Chess(fen);
    const mv = c.move(san);
    let f = c.fen();
    if (mv.flags.includes('b')) {
      const p = f.split(' ');
      p[3] = mv.to[0] + (mv.color === 'w' ? '3' : '6');
      f = p.join(' ');
    }
    return f;
  }

  const S = { queue: [startFen], crawl: {}, studyMap: {}, errors: [] };
  window.__crawlState = S; // inspectable while running

  async function worker() {
    while (S.queue.length) {
      const fen = S.queue.shift();
      if (S.crawl[fen]) continue;
      S.crawl[fen] = 'pending';
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        try {
          const r = await fetch(base + encodeURIComponent(fen), { credentials: 'include' });
          if (!r.ok) { await sleep(1200); continue; } // likely rate limit — back off
          const j = await r.json();
          for (const st of (j.studies || [])) S.studyMap[st.id] = { name: st.name, chapterId: st.chapterId };
          S.crawl[fen] = { m: j.moves || [], s: (j.studies || []).map(st => st.id) };
          for (const san of (j.moves || [])) {
            try { const cf = childFen(fen, san); if (!S.crawl[cf]) S.queue.push(cf); }
            catch (e) { S.errors.push([fen, san, String(e)]); }
          }
          ok = true;
        } catch (e) { await sleep(1200); } // network blip / rate limit
      }
      if (!ok) { S.errors.push([fen, 'gave up']); delete S.crawl[fen]; }
      await sleep(60); // be polite; ~3 workers x this pace avoids rate limiting
    }
  }

  const progress = setInterval(() =>
    console.log(`crawled ${Object.keys(S.crawl).length} positions, queue ${S.queue.length}, errors ${S.errors.length}`), 4000);
  await Promise.all([worker(), worker(), worker()]);
  clearInterval(progress);

  if (S.errors.length) console.warn('errors:', S.errors);

  // course metadata + chapter names (raw responses, kept verbatim)
  let courseMeta = null, chapters = null;
  try { courseMeta = await (await fetch(`https://cag.chessly.com/beta/openings/courses/${courseId}`, { credentials: 'include' })).json(); } catch (e) {}
  try { chapters = await (await fetch(`https://cag.chessly.com/beta/openings/courses/${courseId}/chapters`, { credentials: 'include' })).json(); } catch (e) {}

  const courseName = courseMeta?.name || document.title;
  const out = JSON.stringify({
    course: { id: courseId, name: courseName, url: `https://chessly.com/courses/${courseId}` },
    courseMeta, chapters,
    startFen, studies: S.studyMap, positions: S.crawl
  });
  const slug = courseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' }));
  a.download = `chessly-${slug}-raw.json`;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`DONE: ${Object.keys(S.crawl).length} positions, ${S.errors.length} errors. Downloaded chessly-${slug}-raw.json`);
})();
