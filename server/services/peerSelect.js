'use strict';
// ── Peer picker: the ONE peer-selection path (FIX 8; one rule for every target since FIX 24) ───────────
//
// Every consumer of auto-selected peers (/api/peers → Comparables slide, /api/sector-multiple) calls
// selectPeers() through server.js. There is no second picker and no default list.
//
// THE RULE (Fix 24, as revised in its follow-up). Every candidate not kept is in `dropped` with the rule that dropped it.
//   1. Candidates: FMP stock-peers for the target, plus the EDGAR registrants that carry the target's 4-digit SIC
//      (EDGAR's company list by SIC; SIC from the same submissions JSON the app's SIC cache reads). A catch-all SIC
//      (CATCH_ALL_SIC: 7389 business services, 6770 blank checks, 6798 REITs, 9995 non-operating) lists "anything", so
//      its EDGAR list is not used and a shared catch-all SIC is not a match.
//      A hand-set override (peerOverrides.js) replaces the candidates and the industry test (it IS the industry
//      judgment), and is exempt from the size band; it passes every other keep-filter below.
//   2. Keep a candidate only if all of:
//      a. same FMP industry, or same 4-digit SIC (not a catch-all)                        [not for overrides]
//      b. market cap 0.1×–10× the target's, in USD: the candidate's cap is FMP's, from its screen of actively traded
//         companies on NYSE, Nasdaq or NYSE American (USD-quoted), so a cap in yen or won never meets a cap in dollars
//                                                                                         [not for overrides]
//      c. US-listed: on that screen (or, for a hand-set name outside the band, on a US exchange per its FMP profile)
//         AND in SEC company_tickers.json; Fix 21's registration check does not block it (a failed check never
//         blocks); and a 10-K/10-Q (or, see e, a 20-F/40-F) filed in the past 12 months
//      d. Comparables has its data: a live price, a share count and revenue in the app's own /quote
//      e. a 20-F/40-F filer (an ADR) is a peer only of a foreign target (one that files 20-F/40-F), and only with the
//         same FMP industry                                                               [not for overrides]
//      f. not the acquirer or the target, and one entry per registrant (GOOGL/GOOG are one company: same CIK)
//   3. Rank: (a) in FMP's peer list AND same FMP industry; (b) same FMP industry AND same 4-digit SIC; (c) one of the
//      two; within each tier, closeness of market cap (|ln(cap ÷ target)|), ticker as the tie-break. Keep up to 5.
//   4. Fewer than 3: first widen the size band to 0.05×–20× ('broadened-size'); still fewer, take the one industry
//      step inside that band ('broadened-industry'):
//        target SIC specific → 3-digit SIC (the other codes of the target's SIC group, and stock-peers sharing it);
//        target SIC catch-all or absent → the stock-peers in the same FMP sector whose industry shares its keyword
//        ("Software - Application" → "Software").
//      Still fewer than 3 → the peers there are, with the reason (trust 'untrusted', so no sector median uses them).
//      Never filled with unrelated companies. Hand-set lists are never widened.
//
// Market cap: the target's is the app's own (live price × /quote shares, the figure the slide's target column shows),
// passed in by server.js. Nothing here estimates or defaults a figure: a missing market cap, price, share count or
// revenue drops the candidate, it never becomes 0.

const BAND_LO = 0.1;
const BAND_HI = 10;
const WIDE_LO = 0.05;   // rule 4a, the size step
const WIDE_HI = 20;
const US_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX']);
const MAX_PEERS = 5;
const MIN_PEERS = 3;
const FILING_LOOKBACK_DAYS = 365;
const DOMESTIC_FORMS = new Set(['10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT', '10-KT/A']);
const FOREIGN_FORMS = new Set(['20-F', '40-F', '20-F/A', '40-F/A']);
// Catch-all SIC codes: a shared code says nothing about the business (Fix 24 brief, TRAPS; 6798 REITs in its follow-up:
// towers, data centres, billboards and timber all file under it).
const CATCH_ALL_SIC = new Set(['7389', '6770', '6798', '9995']);
const SUBMISSIONS_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

// Footnote label per source (the slide prints these; SectionComparables.peerSourceNote).
const SOURCE_LABEL = {
  'fmp-industry': 'FMP peer + industry match',
  'industry-sic': 'industry + SIC match',
  industry: 'industry match',
  sic: 'SIC match',
  'broadened-size': 'broadened: size',
  'broadened-industry': 'broadened: industry',
  override: 'hand-set',
};

const up = (t) => (t == null ? null : String(t).trim().toUpperCase() || null);
const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const keywordOf = (industry) => (industry ? String(industry).split(' - ')[0].trim() || null : null);
const fmtCapM = (v) => `$${Math.round(v / 1e6).toLocaleString('en-US')}M`;

// Latest periodic report in a raw SEC submissions payload: domestic (10-K/10-Q family) and foreign (20-F/40-F), plus the
// latest filing of any form (for the drop note, e.g. "last: 6-K 2026-10-29").
function summarizeSubmissions(data) {
  const r = data && data.filings && data.filings.recent;
  const forms = (r && r.form) || [];
  const dates = (r && r.filingDate) || [];
  let lastPeriodic = null, lastDomestic = null, lastForeign = null;
  const lastByForm = {};
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i], d = dates[i];
    if (!f || !d) continue;
    if (!lastByForm[f] || d > lastByForm[f]) lastByForm[f] = d;
    if (DOMESTIC_FORMS.has(f) && (!lastDomestic || d > lastDomestic.date)) lastDomestic = { form: f, date: d };
    if (FOREIGN_FORMS.has(f) && (!lastForeign || d > lastForeign.date)) lastForeign = { form: f, date: d };
  }
  // lastPeriodic keeps its Fix 8 meaning (10-K/10-Q family only).
  lastPeriodic = lastDomestic;
  const recentForms = Object.entries(lastByForm).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 3)
    .map(([f, d]) => `${f} ${d}`);
  return { sic: data && data.sic ? String(data.sic) : null, lastPeriodic, lastDomestic, lastForeign, recentForms };
}

// Which kind of filer: 'foreign' when its latest annual/periodic report is a 20-F/40-F newer than any 10-K/10-Q.
function filerKind(s) {
  if (!s) return null;
  if (s.lastForeign && (!s.lastDomestic || s.lastForeign.date > s.lastDomestic.date)) return 'foreign';
  if (s.lastDomestic) return 'domestic';
  return null;
}

function createPeerSelector(deps) {
  const {
    overrides = {},
    cikFor,               // (ticker) → 10-digit CIK | null   (SEC company_tickers.json)
    tickersForCik = () => [], // (cik) → that registrant's tickers in SEC list order
    fetchSubmissions,     // (cik) → raw SEC submissions JSON (throws on failure)
    fmpStockPeers,        // (ticker) → [{ symbol, mktCap }]  (throws on failure)
    fmpProfile = async () => null, // (ticker) → { industry, sector, marketCap, exchange, currency, isActivelyTrading } | null
    fmpUniverse,          // (loUsd, hiUsd) → [{ symbol, marketCap, industry, sector, exchangeShortName }] (throws on failure)
    sicCompanies = async () => [], // (sic4) → [cik] from EDGAR's company list for that SIC (throws on failure)
    registrationBlock = async () => null, // Fix 21: (ticker) → { name, date, form } when deregistered, else null; never throws
    targetMarketCap,      // (ticker) → { value: $ | null, detail }
    dataAvailable,        // (ticker) → { price: bool, shares: bool, revenue: bool, transient?: bool }
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

  async function select(target, acquirer) {
    const T = up(target);
    const A = up(acquirer);
    const base = { target: T, acquirer: A, band: [BAND_LO, BAND_HI], wideBand: [WIDE_LO, WIDE_HI], dropped: [] };
    let cacheable = true;
    const decided = new Map(); // symbol → drop record (rebuilt into base.dropped at the end)
    const drop = (c, rule, detail) => { decided.set(c.symbol, { ticker: c.symbol, stage: c.stage, rule, detail: detail ?? null }); return false; };
    const finish = (out) => ({ ...out, dropped: [...decided.values()], cacheable });
    const noPeers = (reason, extra = {}) => finish({ ...base, ...extra, peers: [], peerSources: {}, source: 'none', trust: 'untrusted', reason });

    // ── The target ────────────────────────────────────────────────────────────
    const tcap = await targetMarketCap(T);
    const targetCap = posNum(tcap && tcap.value);
    base.targetMarketCap = targetCap;
    base.targetMarketCapDetail = (tcap && tcap.detail) || null;
    // Not cached: a price or share count that failed to load this minute is not a company without a market cap.
    if (targetCap == null) { cacheable = false; return noPeers(`No market cap for ${T}, so the ${BAND_LO}×–${BAND_HI}× size band cannot be applied`); }

    const tcik = cikFor(T);
    const acik = A ? cikFor(A) : null;
    const tsub = tcik ? await submissionsFor(tcik) : null;
    base.targetSic = tsub ? tsub.sic : null;
    const tprof = await fmpProfile(T);
    base.industry = (tprof && tprof.industry) || null;
    base.sector = (tprof && tprof.sector) || null;
    // Foreign target: files 20-F/40-F; with no SEC filings, FMP's own ADR/country flags say so.
    const tkind = filerKind(tsub);
    base.targetForeign = tkind ? tkind === 'foreign' : !!(tprof && (tprof.isAdr === true || (tprof.country && tprof.country !== 'US')));
    const tSic = base.targetSic;
    const tSicSpecific = !!tSic && !CATCH_ALL_SIC.has(tSic);
    base.sic3 = tSicSpecific ? tSic.slice(0, 3) : null;

    // One screen at the WIDE band: the strict pass keeps 0.1×–10×; the size step (rule 4) may use 0.05×–20×.
    const lo = WIDE_LO * targetCap, hi = WIDE_HI * targetCap;
    let universeRows;
    try { universeRows = await fmpUniverse(lo, hi); }
    catch (e) { cacheable = false; return noPeers(`FMP company screen unavailable (${e.message})`); }
    const universe = new Map();
    for (const r of Array.isArray(universeRows) ? universeRows : []) {
      const s = up(r && r.symbol);
      if (s && !universe.has(s)) universe.set(s, r);
    }
    base.universeCount = universe.size;

    const today = now();
    const cutoff = new Date(today.getTime() - FILING_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const seenSym = new Set();
    const seenCik = new Map(); // cik → first symbol considered
    const isOverride = !!overrides[T];
    const inBand = (r) => r >= BAND_LO && r <= BAND_HI;
    const inWide = (r) => r >= WIDE_LO && r <= WIDE_HI;

    // ── Cheap checks: deal party, duplicate, SEC filer, US-listed, USD market cap ──
    // Returns true when the candidate may go on. c.sizeWide marks one that is inside 0.05×–20× but outside 0.1×–10×
    // (kept for the size step only). A hand-set name has no size test at all (rule 2b exemption).
    async function cheap(c) {
      if (seenSym.has(c.symbol)) return false; // the same ticker twice (stock-peer and EDGAR list): first source wins
      seenSym.add(c.symbol);
      if (c.symbol === T || (A && c.symbol === A)) return drop(c, 'target-or-acquirer');
      c.cik = cikFor(c.symbol);
      if (!c.cik) return drop(c, 'not-sec-filer', 'not in SEC company_tickers.json');
      if (c.cik === tcik || (acik && c.cik === acik)) return drop(c, 'target-or-acquirer', `same SEC registrant as ${c.cik === tcik ? T : A}`);
      if (seenCik.has(c.cik)) return drop(c, 'same-company', `same SEC registrant as ${seenCik.get(c.cik)} (one entry per company)`);
      seenCik.set(c.cik, c.symbol);
      const u = universe.get(c.symbol);
      if (u && posNum(u.marketCap) != null) {
        c.cap = u.marketCap; c.industry = u.industry || null; c.sector = u.sector || null;
      } else {
        // Not on the wide screen. An EDGAR-list name is simply absent from it; for a stock-peer or a hand-set name the
        // FMP profile says which test failed (a hand-set name outside the band is still a candidate).
        if (c.stage.startsWith('edgar-')) return drop(c, 'not-in-screen', `not in FMP's screen of actively traded US-listed companies at ${WIDE_LO}×–${WIDE_HI}× (${fmtCapM(lo)}–${fmtCapM(hi)})`);
        const p = await fmpProfile(c.symbol);
        if (!p) return drop(c, 'not-us-listed', 'no FMP profile');
        if (p.isActivelyTrading === false) return drop(c, 'not-actively-trading', 'FMP isActivelyTrading is false');
        if (!US_EXCHANGES.has(String(p.exchange || '').toUpperCase())) return drop(c, 'not-us-listed', `listed on ${p.exchange || 'no exchange'}`);
        const cap = posNum(p.marketCap);
        if (cap == null || (p.currency && p.currency !== 'USD')) return drop(c, 'no-market-cap', cap == null ? 'FMP returned no market cap' : `market cap in ${p.currency}, not USD`);
        const r = cap / targetCap;
        if (c.stage !== 'override') {
          if (inWide(r)) return drop(c, 'not-in-screen', `profile cap ${r.toFixed(3)}× target, but absent from FMP's screen of actively traded US-listed companies`);
          return drop(c, 'size-band', `${r.toFixed(3)}× target`);
        }
        c.cap = cap; c.industry = p.industry || null; c.sector = p.sector || null;
      }
      c.ratio = c.cap / targetCap;
      if (c.stage !== 'override') {
        if (!inWide(c.ratio)) return drop(c, 'size-band', `${c.ratio.toFixed(3)}× target`);
        c.sizeWide = !inBand(c.ratio);
      }
      return true;
    }

    // ── Industry test (rule 2a) and tier (rule 3) ────────────────────────────
    //   tier 0: in FMP's peer list AND same FMP industry
    //   tier 1: same FMP industry AND same 4-digit SIC (not a catch-all)
    //   tier 2: one of the two
    //   tier 3: neither (dropped, unless hand-set or a widening step admits it)
    function classify(c) {
      c.indMatch = !!(base.industry && c.industry && c.industry === base.industry);
      c.sicMatch = !!(tSicSpecific && c.sic && c.sic === tSic);
      c.inPeers = c.stage === 'fmp-peers';
      c.tier = c.inPeers && c.indMatch ? 0 : (c.indMatch && c.sicMatch ? 1 : (c.indMatch || c.sicMatch ? 2 : 3));
      c.source = c.stage === 'override' ? 'override'
        : (['fmp-industry', 'industry-sic', c.indMatch ? 'industry' : 'sic', 'none'][c.tier]);
    }
    const dist = (c) => Math.abs(Math.log(c.ratio));
    const byRank = (a, b) => (a.tier - b.tier) || (dist(a) - dist(b)) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);

    const kept = [];
    // Lazy checks in rank order: filings + ADR rule, registration, then data (only until MAX_PEERS are kept).
    async function evaluate(ranked) {
      for (const c of ranked) {
        const s = c.sub || await submissionsFor(c.cik);
        c.sub = s;
        const kind = filerKind(s);
        const last = kind === 'foreign' ? s.lastForeign : s.lastDomestic;
        if (!last || last.date < cutoff) {
          drop(c, 'no-recent-periodic-report', `no 10-K/10-Q/20-F/40-F since ${cutoff}${s.recentForms.length ? `; last: ${s.recentForms.join(', ')}` : ''}`);
          continue;
        }
        if (kind === 'foreign' && c.stage !== 'override') {
          if (!base.targetForeign) { drop(c, 'foreign-filer', `files ${last.form}; a 20-F/40-F filer is a peer only of a foreign target`); continue; }
          if (!c.indMatch) { drop(c, 'foreign-filer', `files ${last.form}; an ADR peer needs the same FMP industry (${c.industry || '—'} vs ${base.industry || '—'})`); continue; }
        }
        const block = await registrationBlock(c.symbol);
        if (block) { drop(c, 'deregistered', `Form ${block.form} ${block.date}`); continue; }
        if (kept.length >= MAX_PEERS) { drop(c, 'ranked-out', `passed every check except data, which was not checked; ${MAX_PEERS} higher-ranked peers already kept`); continue; }
        const d = await dataAvailable(c.symbol);
        const missing = ['price', 'shares', 'revenue'].filter((k) => !(d && d[k]));
        if (missing.length) {
          if (d && d.transient) cacheable = false;
          drop(c, 'no-data', `no ${missing.join(', ')} in the app's data for this ticker`);
          continue;
        }
        decided.delete(c.symbol);
        kept.push(c);
      }
    }

    // SIC for a candidate that passed the cheap checks: the EDGAR list already says it; else read submissions.
    async function withSic(c) {
      if (!c.sic) { c.sub = await submissionsFor(c.cik); c.sic = c.sub.sic; }
      return c;
    }
    const listCands = (ciks, stage, sic) => [...new Set(ciks)].map((cik) => {
      const tickers = tickersForCik(cik);
      if (!tickers.length) return null; // no current ticker: not listed
      const sym = tickers.find((t) => universe.has(t)) || tickers[0];
      return { symbol: up(sym), stage, sic };
    }).filter(Boolean).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

    // ── Rule 1: candidates ───────────────────────────────────────────────────
    let cands;
    if (isOverride) {
      cands = overrides[T].map((s) => ({ symbol: up(s), stage: 'override' })).filter((c) => c.symbol);
      base.candidateSource = 'override';
    } else {
      let sp;
      try { sp = await fmpStockPeers(T); }
      catch (e) { cacheable = false; return noPeers(`FMP stock-peers unavailable for ${T} (${e.message})`); }
      const spCands = (Array.isArray(sp) ? sp : [])
        .map((r) => ({ symbol: up(r && r.symbol), stage: 'fmp-peers' }))
        .filter((c) => c.symbol)
        .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
      base.stockPeerCount = spCands.length;
      let sicCands = [];
      if (tSicSpecific) {
        try {
          const ciks = await sicCompanies(tSic);
          base.sicListCount = ciks.length;
          sicCands = listCands(ciks, 'edgar-sic', tSic);
        } catch (e) {
          cacheable = false;
          base.sicList = `EDGAR company list for SIC ${tSic} unavailable (${e.message}); FMP stock-peers only`;
        }
      } else {
        base.sicList = tSic ? `skipped: SIC ${tSic} is a catch-all` : `skipped: ${T} has no SEC SIC code`;
      }
      cands = [...spCands, ...sicCands];
    }
    base.candidateCount = cands.length;

    const passed = [];
    for (const c of cands) if (await cheap(c)) passed.push(c);
    for (const c of passed) { await withSic(c); classify(c); }
    const strict = isOverride ? passed : passed.filter((c) => {
      if (c.tier === 3) return drop(c, 'industry-mismatch', `FMP industry ${c.industry || '—'} vs ${base.industry || '—'}; SIC ${c.sic || '—'} vs ${tSic || '—'}${tSic && !tSicSpecific ? ' (catch-all)' : ''}`);
      if (c.sizeWide) return drop(c, 'size-band', `${c.ratio.toFixed(3)}× target`);
      return true;
    });
    await evaluate(strict.sort(byRank));

    // ── Rule 4: fewer than 3 → widen size, then the one industry step ────────
    const broadened = [];
    let sizeWidened = false;
    if (!isOverride && kept.length < MIN_PEERS) {
      // 4a. Size: the industry/SIC matches between 0.05×–0.1× and 10×–20×.
      const n0 = kept.length;
      const sizePool = passed.filter((c) => c.tier < 3 && c.sizeWide);
      sizePool.forEach((c) => { c.source = 'broadened-size'; decided.delete(c.symbol); });
      await evaluate(sizePool.sort(byRank));
      sizeWidened = true;
      broadened.push({ kind: 'size', step: `size band ${WIDE_LO}×–${WIDE_HI}×`, why: `only ${n0} compan${n0 === 1 ? 'y' : 'ies'} matched within ${BAND_LO}×–${BAND_HI}×`, added: kept.length - n0 });
    }
    if (!isOverride && kept.length < MIN_PEERS) {
      // 4b. Industry: one step, inside the widened size band.
      const n1 = kept.length;
      let step, pool = [];
      const mismatched = passed.filter((c) => c.tier === 3);
      if (tSicSpecific) {
        const sic3 = tSic.slice(0, 3);
        step = `3-digit SIC ${sic3}`;
        pool = mismatched.filter((c) => c.sic && c.sic.startsWith(sic3) && !CATCH_ALL_SIC.has(c.sic));
        const extra = [];
        for (let d = 0; d <= 9; d++) {
          const code = `${sic3}${d}`;
          if (code === tSic || CATCH_ALL_SIC.has(code)) continue;
          let ciks;
          try { ciks = await sicCompanies(code); }
          catch (e) { cacheable = false; base.sicList = `${base.sicList ? `${base.sicList}; ` : ''}EDGAR company list for SIC ${code} unavailable (${e.message})`; continue; }
          extra.push(...listCands(ciks, 'edgar-sic3', code));
        }
        extra.sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
        for (const c of extra) if (await cheap(c)) { classify(c); pool.push(c); }
      } else if (base.sector && keywordOf(base.industry)) {
        const kw = keywordOf(base.industry);
        step = `FMP sector ${base.sector} + industry keyword "${kw}"`;
        pool = mismatched.filter((c) => c.sector === base.sector && keywordOf(c.industry) === kw);
      }
      if (step) {
        pool.forEach((c) => { c.source = 'broadened-industry'; decided.delete(c.symbol); });
        await evaluate(pool.sort((a, b) => (dist(a) - dist(b)) || (a.symbol < b.symbol ? -1 : 1)));
        broadened.push({ kind: 'industry', step, why: `only ${n1} compan${n1 === 1 ? 'y' : 'ies'} matched the target's FMP industry or 4-digit SIC`, added: kept.length - n1 });
      }
    }
    if (broadened.length) base.broadened = broadened;

    const screened = kept.map((c) => ({ ticker: c.symbol, source: c.source, tier: c.tier, stage: c.stage, ratio: +c.ratio.toFixed(4), sic: c.sic || null, industry: c.industry || null }));
    const peers = kept.map((c) => c.symbol);
    const peerSources = Object.fromEntries(kept.map((c) => [c.symbol, c.source]));
    const label = isOverride ? 'override' : 'fmp';
    if (kept.length < MIN_PEERS) {
      // A foreign target (20-F/40-F) with nothing left: say it in the brief's words (Fix 24 rule 6).
      const head = kept.length === 0 && base.targetForeign
        ? 'No comparable US-listed peers found'
        : `Only ${kept.length} compan${kept.length === 1 ? 'y' : 'ies'} passed the peer screen (need ${MIN_PEERS})`;
      return finish({ ...base, screened, peers, peerSources, source: (kept.length || isOverride) ? label : 'none', trust: 'untrusted',   // an emptied hand-set list is still hand-set
        reason: `${head}: ${whyFew(decided, isOverride, sizeWidened)}` });
    }
    return finish({ ...base, screened, peers, peerSources, source: label, trust: 'trusted', reason: null });
  }

  // One short clause naming what removed the candidates, most common rule first, up to 3 tickers each.
  function whyFew(decided, isOverride, sizeWidened) {
    const [blo, bhi] = sizeWidened ? [WIDE_LO, WIDE_HI] : [BAND_LO, BAND_HI];
    const TEXT = {
      'target-or-acquirer': 'the deal parties', 'not-sec-filer': 'not SEC filers', 'same-company': 'another class of a listed company',
      'size-band': `outside ${blo}×–${bhi}× the target's market cap`, 'not-us-listed': 'not US-listed', 'not-actively-trading': 'not trading',
      'no-market-cap': 'no USD market cap', 'not-in-screen': `not US-listed and trading within ${WIDE_LO}×–${WIDE_HI}×`, 'industry-mismatch': 'a different FMP industry and SIC', 'no-recent-periodic-report': 'no periodic report in 12 months',
      'foreign-filer': 'foreign filers (20-F/40-F) not admitted', deregistered: 'deregistered', 'no-data': 'no price, share count or revenue',
    };
    const by = new Map();
    for (const d of decided.values()) by.set(d.rule, [...(by.get(d.rule) || []), d.ticker]);
    // EDGAR-list names absent from the band screen are many and say little: they come last.
    const parts = [...by].filter(([rule]) => rule !== 'ranked-out')
      .sort((a, b) => ((a[0] === 'not-in-screen') - (b[0] === 'not-in-screen')) || (b[1].length - a[1].length) || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([rule, t]) => `${t.length} ${TEXT[rule] || rule}${t.length <= 3 ? ` (${t.join(', ')})` : ` (${t.slice(0, 3).join(', ')}, …)`}`);
    return parts.length ? `${isOverride ? 'of the hand-set list, ' : ''}${parts.join('; ')}` : 'no candidates';
  }

  // Cached per (target, acquirer). Only a completed screen is cached — an upstream failure (FMP/SEC down, a price that
  // could not be fetched) is not, and the next request retries.
  async function selectPeers(target, { acquirer = null } = {}) {
    const key = `${up(target)}|${up(acquirer) || ''}`;
    const hit = resultCache.get(key);
    if (hit && now().getTime() - hit.ts < RESULT_TTL_MS) return hit.result;
    const { cacheable, ...result } = await select(target, acquirer);
    if (cacheable) resultCache.set(key, { ts: now().getTime(), result });
    return result;
  }

  return { selectPeers, _select: async (t, a) => { const { cacheable, ...r } = await select(t, a); return r; } };
}

module.exports = { createPeerSelector, summarizeSubmissions, filerKind, keywordOf, SOURCE_LABEL, CATCH_ALL_SIC, BAND_LO, BAND_HI, WIDE_LO, WIDE_HI, MAX_PEERS, MIN_PEERS };
