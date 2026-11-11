'use strict';
// ── Peer picker: FMP candidates + filters. The ONE peer-selection path (FIX 8) ───────────────────────
//
// Every consumer of auto-selected peers (/api/peers → Comparables slide, /api/sector-multiple) calls
// selectPeers() through server.js. It replaces the SIC-cache neighbour matching, SECTOR_PEERS and the
// BROAD_DEFAULT mega-caps, all of which depended on which tickers the server had looked up before.
//
// Rules, in order. Every candidate that is not kept is recorded in `dropped` with the rule that dropped it.
//   1. A hand-set override (peerOverrides.js) wins and skips every filter below.
//   2. Candidates: FMP stock-peers for the target.
//   3. Keep only: not the target or the acquirer; ticker in SEC company_tickers.json (a US SEC filer);
//      market cap 0.1×–10× the target's; a 10-K or 10-Q filed in the past 12 months (drops 20-F/40-F
//      filers); revenue available.
//   4. Fewer than 5 survive → backfill from FMP's same-industry screener, but only names that are actively
//      trading (FMP isActivelyTrading) AND share the target's first 3 SIC digits. Same filters as step 3.
//   5. Rank: stock-peers before backfill, then closest market cap (|ln(cap ÷ target cap)|), ticker as the
//      tie-break. Keep the top 5.
//   6. Fewer than 3 survive → no peer set (trust 'untrusted', peers []), with the reason. Never a default list.
//
// Market cap: the target's is the app's own (live price × /quote shares, the figure the slide's target
// column shows), passed in by server.js. Candidates' caps are the ones FMP returns with the candidate.
// SIC and filing dates come from SEC submissions for each candidate, fetched on demand and cached by CIK,
// so the result never depends on which tickers the server has looked up before.
//
// The revenue check (a full /quote) runs lazily in rank order: once 5 are kept, lower-ranked candidates
// that passed every other check are recorded as 'ranked-out'. Nothing here estimates or defaults a figure: a
// missing market cap or revenue drops the candidate, it never becomes 0.

const BAND_LO = 0.1;
const BAND_HI = 10;
const MAX_PEERS = 5;
const MIN_PEERS = 3;
const FILING_LOOKBACK_DAYS = 365;
const PERIODIC_FORMS = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT', '10-KT/A']);
const SUBMISSIONS_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

const SOURCE_LABEL = {
  override: 'set by hand',
  'fmp-peers': 'FMP peers',
  'fmp-industry-sic': 'FMP industry + SIC', // + the 3 digits, added where it is printed
};

const up = (t) => (t == null ? null : String(t).trim().toUpperCase() || null);
const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

// Most recent 10-K/10-Q-family filing in a raw SEC submissions payload, plus the latest filing of any
// form (for the drop note, e.g. "last: 20-F 2026-03-17").
function summarizeSubmissions(data) {
  const r = data && data.filings && data.filings.recent;
  const forms = (r && r.form) || [];
  const dates = (r && r.filingDate) || [];
  let lastPeriodic = null;
  const lastByForm = {};
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i], d = dates[i];
    if (!f || !d) continue;
    if (!lastByForm[f] || d > lastByForm[f]) lastByForm[f] = d;
    if (PERIODIC_FORMS.has(f) && (!lastPeriodic || d > lastPeriodic.date)) lastPeriodic = { form: f, date: d };
  }
  const recentForms = Object.entries(lastByForm).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 3)
    .map(([f, d]) => `${f} ${d}`);
  return { sic: data && data.sic ? String(data.sic) : null, lastPeriodic, recentForms };
}

function createPeerSelector(deps) {
  const {
    overrides = {},
    cikFor,               // (ticker) → 10-digit CIK | null   (SEC company_tickers.json)
    fetchSubmissions,     // (cik) → raw SEC submissions JSON (throws on failure)
    fmpStockPeers,        // (ticker) → [{ symbol, mktCap }]  (throws on failure)
    fmpIndustry,          // (ticker) → FMP profile industry | null
    fmpScreener,          // (industry) → [{ symbol, marketCap, isActivelyTrading }] (throws on failure)
    targetMarketCap,      // (ticker) → { value: $ | null, detail }
    revenueAvailable,     // (ticker) → boolean
    now = () => new Date(),
  } = deps;

  const subsCache = new Map();   // cik → { ts, summary }
  const resultCache = new Map(); // `${target}|${acquirer}` → { ts, result }

  async function submissionsFor(cik) {
    const hit = subsCache.get(cik);
    if (hit && now().getTime() - hit.ts < SUBMISSIONS_TTL_MS) return hit.summary;
    let data;
    try { data = await fetchSubmissions(cik); }
    catch (e) { data = await fetchSubmissions(cik); } // one retry; a second failure propagates (never "no filings")
    const summary = summarizeSubmissions(data);
    subsCache.set(cik, { ts: now().getTime(), summary });
    return summary;
  }

  function noPeers(base, reason) {
    return { ...base, peers: [], peerSources: {}, source: 'none', trust: 'untrusted', reason };
  }

  async function select(target, acquirer) {
    const T = up(target);
    const A = up(acquirer);
    const base = { target: T, acquirer: A, band: [BAND_LO, BAND_HI], dropped: [] };

    // Rule 1 — hand-set override wins, skips every filter.
    if (overrides[T]) {
      const peers = [...overrides[T]];
      return { ...base, peers, source: 'override', trust: 'trusted', reason: null,
        peerSources: Object.fromEntries(peers.map((p) => [p, 'override'])) };
    }

    const dropped = base.dropped;
    const drop = (c, rule, detail) => dropped.push({ ticker: c.symbol, stage: c.stage, rule, detail: detail ?? null });

    const tcap = await targetMarketCap(T);
    const targetCap = posNum(tcap && tcap.value);
    base.targetMarketCap = targetCap;
    base.targetMarketCapDetail = (tcap && tcap.detail) || null;
    if (targetCap == null) return noPeers(base, `No market cap for ${T}, so the 0.1×–10× size band cannot be applied`);

    const today = now();
    const cutoff = new Date(today.getTime() - FILING_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const ratioOf = (cap) => cap / targetCap;
    const dist = (c) => Math.abs(Math.log(c.ratio));
    const byRank = (a, b) => (dist(a) - dist(b)) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);

    // Cheap checks (no network beyond the ticker map). Returns true when the candidate survives them.
    const seen = new Set();
    function cheap(c) {
      if (c.symbol === T || (A && c.symbol === A)) { drop(c, 'target-or-acquirer'); return false; }
      if (seen.has(c.symbol)) { drop(c, 'duplicate', 'already considered'); return false; }
      seen.add(c.symbol);
      if (c.stage === 'fmp-industry-sic' && c.active !== true) { drop(c, 'not-actively-trading', 'FMP isActivelyTrading is not true'); return false; }
      c.cik = cikFor(c.symbol);
      if (!c.cik) { drop(c, 'not-sec-filer', 'not in SEC company_tickers.json'); return false; }
      if (c.cap == null) { drop(c, 'no-market-cap', 'FMP returned no market cap'); return false; }
      c.ratio = ratioOf(c.cap);
      if (c.ratio < BAND_LO || c.ratio > BAND_HI) { drop(c, 'size-band', `${c.ratio.toFixed(3)}× target`); return false; }
      return true;
    }

    // SEC checks (submissions, cached by CIK).
    async function sec(c, targetSic3) {
      const s = await submissionsFor(c.cik);
      c.sic = s.sic;
      if (c.stage === 'fmp-industry-sic') {
        const sic3 = s.sic ? s.sic.slice(0, 3) : null;
        if (sic3 !== targetSic3) { drop(c, 'sic-mismatch', `SIC ${s.sic || 'none'} vs target ${targetSic3}`); return false; }
      }
      if (!s.lastPeriodic || s.lastPeriodic.date < cutoff) {
        drop(c, 'no-recent-10k-10q', `no 10-K/10-Q since ${cutoff}${s.recentForms.length ? `; last: ${s.recentForms.join(', ')}` : ''}`);
        return false;
      }
      return true;
    }

    const kept = [];
    // Evaluate a ranked list: the SEC checks run for every candidate (so each drop names its real rule);
    // only the revenue check is lazy, stopping once MAX_PEERS are kept.
    async function evaluate(ranked, targetSic3) {
      for (const c of ranked) {
        if (!await sec(c, targetSic3)) continue;
        if (kept.length >= MAX_PEERS) { drop(c, 'ranked-out', `passed every check except revenue, which was not checked; ${MAX_PEERS} closer-ranked peers already kept`); continue; }
        if (!await revenueAvailable(c.symbol)) { drop(c, 'no-revenue', 'no revenue in the app\'s /quote for this ticker'); continue; }
        kept.push(c);
      }
    }

    // Rule 2/3 — FMP stock-peers.
    let sp;
    try { sp = await fmpStockPeers(T); }
    catch (e) { return noPeers(base, `FMP stock-peers unavailable for ${T} (${e.message})`); }
    const spCands = (Array.isArray(sp) ? sp : [])
      .map((r) => ({ symbol: up(r && r.symbol), cap: posNum(r && r.mktCap), stage: 'fmp-peers' }))
      .filter((c) => c.symbol)
      .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
    base.stockPeerCount = spCands.length;
    const spPass = spCands.filter(cheap).sort(byRank);
    await evaluate(spPass, null);

    // Rule 4 — backfill from the same-industry screener, SIC-matched.
    let targetSic3 = null;
    if (kept.length < MAX_PEERS) {
      const tcik = cikFor(T);
      const tsub = tcik ? await submissionsFor(tcik) : null;
      base.targetSic = tsub ? tsub.sic : null;
      targetSic3 = base.targetSic ? base.targetSic.slice(0, 3) : null;
      const industry = await fmpIndustry(T);
      base.industry = industry || null;
      if (!targetSic3) base.backfill = `skipped: ${T} has no SEC SIC code`;
      else if (!industry) base.backfill = `skipped: no FMP industry for ${T}`;
      else {
        let rows;
        try { rows = await fmpScreener(industry); }
        catch (e) { return noPeers(base, `FMP screener unavailable for "${industry}" (${e.message})`); }
        const bfCands = (Array.isArray(rows) ? rows : [])
          .map((r) => ({ symbol: up(r && r.symbol), cap: posNum(r && r.marketCap), active: r && r.isActivelyTrading, stage: 'fmp-industry-sic' }))
          .filter((c) => c.symbol)
          .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
        base.screenerCount = bfCands.length;
        const bfPass = bfCands.filter(cheap).sort(byRank);
        await evaluate(bfPass, targetSic3);
        base.backfill = 'ran';
      }
    } else {
      base.backfill = `not needed: ${MAX_PEERS} FMP peers passed`;
    }

    // Rule 5 is the evaluation order above (stock-peers first, each list by closeness). Rule 6:
    const screened = kept.map((c) => ({ ticker: c.symbol, stage: c.stage, ratio: +c.ratio.toFixed(4), sic: c.sic || null }));
    if (kept.length < MIN_PEERS) {
      return { ...noPeers(base, `Only ${kept.length} compan${kept.length === 1 ? 'y' : 'ies'} passed the peer screen (need ${MIN_PEERS})`), screened, sic3: targetSic3 };
    }
    return {
      ...base, screened, sic3: targetSic3,
      peers: kept.map((c) => c.symbol),
      peerSources: Object.fromEntries(kept.map((c) => [c.symbol, c.stage])),
      source: 'fmp', trust: 'trusted', reason: null,
    };
  }

  // Cached per (target, acquirer). Only a completed screen is cached — an upstream failure (FMP/SEC down)
  // throws or returns a reason that names it, and the next request retries.
  async function selectPeers(target, { acquirer = null } = {}) {
    const key = `${up(target)}|${up(acquirer) || ''}`;
    const hit = resultCache.get(key);
    if (hit && now().getTime() - hit.ts < RESULT_TTL_MS) return hit.result;
    const result = await select(target, acquirer);
    const upstreamFailure = result.reason && /unavailable/.test(result.reason) && !/^No market cap/.test(result.reason);
    if (!upstreamFailure) resultCache.set(key, { ts: now().getTime(), result });
    return result;
  }

  return { selectPeers, _select: select };
}

module.exports = { createPeerSelector, summarizeSubmissions, SOURCE_LABEL, BAND_LO, BAND_HI, MAX_PEERS, MIN_PEERS };
