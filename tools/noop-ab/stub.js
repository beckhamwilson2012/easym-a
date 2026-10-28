// ─────────────────────────────────────────────────────────────────────────────
// Deterministic network stub for the no-op A/B harness — record once, replay forever.
//
// WHY: the gate's premise is "identical inputs → identical deck", so a byte diff isolates CODE from
// DATA. The manual (private) path satisfies that by doing no network at all, but it can only build
// the PRIVATE deck — `Public → Public` is ticker-only, and a live ticker fetch is exactly the market
// drift that made the frozen live baseline (STAGE_11A_BASELINE.json) worthless. Stubbing the fetch
// restores a deterministic PUBLIC deck, and with it the three sections the private path suppresses
// (equity / analyst / exchangeratio).
//
// The stub lives entirely in the harness: no app or server code is aware of it, so there is no stub
// path that could ever ship. Interception happens in the browser, at the page level.
//
// HARD FAIL ON MISS is the whole design. A fixture that silently falls through to the live network
// would reintroduce the drift this exists to remove — and it would do so invisibly, which is worse
// than not stubbing at all. So replay answers only what it recorded, records every miss, and the
// caller fails the run. An incomplete fixture is therefore loud, never quiet.
// ─────────────────────────────────────────────────────────────────────────────

// Same-origin data routes. /quote and /search sit at the root (not under /api) — see server.js.
const STUBBABLE = /^\/(api\/|quote(\?|$)|search(\?|$))/;

function pathOf(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return null; }
}

function isStubbable(url) {
  const p = pathOf(url);
  return !!(p && STUBBABLE.test(p));
}

// The fixture key: pathname + querystring, so it is stable across runs for the same tickers.
//
// An earlier version collapsed every /search to a single '/search' key, reasoning that the picker's
// debounce makes the set of prefix queries ('?q=N', '?q=NE', '?q=NET') timing-dependent. That was
// wrong in a way worth recording: `store[key]` keeps the FIRST response per key, so the one recorded
// search body was the acquirer's results and the TARGET's search could never be answered — replay
// hung for 30s waiting for a DDOG option that the fixture could not produce. The real fix belongs on
// the input side: flow.js sets the query in ONE assignment, so exactly one /search?q=<symbol> fires
// per ticker and exact keying is deterministic.
function keyOf(url) {
  return pathOf(url);
}

// ── Record: let the live request through, keep the response body ─────────────
function attachRecorder(page, store) {
  page.on('response', async (res) => {
    const url = res.url();
    if (!isStubbable(url)) return;
    const key = keyOf(url);
    if (!key || store[key]) return;             // first response per key wins (search prefixes)
    try {
      store[key] = {
        status: res.status(),
        contentType: (res.headers()['content-type'] || 'application/json'),
        body: await res.text(),
      };
    } catch { /* body already consumed / redirect — leave unrecorded, replay will flag it */ }
  });
}

// ── Replay: answer from the fixture, refuse everything else ──────────────────
async function attachReplayer(page, store, misses) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!isStubbable(url)) { req.continue(); return; }   // app bundle, fonts, images
    const key = keyOf(url);
    const hit = key && store[key];
    if (!hit) {
      misses.push(key || url);
      // 503 rather than abort: the page handles a failed fetch, and it fails the SAME way in both
      // runs, so the diff stays meaningful while the miss list fails the run.
      req.respond({ status: 503, contentType: 'application/json', body: '{"error":"noop-stub miss"}' });
      return;
    }
    req.respond({ status: hit.status, contentType: hit.contentType, body: hit.body });
  });
}

module.exports = { isStubbable, keyOf, attachRecorder, attachReplayer, STUBBABLE };
