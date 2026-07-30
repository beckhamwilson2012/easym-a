'use strict';
// ── DEF 14A beneficial-ownership parser (Stage 2) — self-validating, with FMP fallback ────────────────────
// Parses the "Security Ownership of Certain Beneficial Owners and Management" table from a target's DEF 14A
// and returns the top holders (5% institutions + insiders) with per-class shares/% for dual-class filers.
// THE INTEGRITY CONTRACT: a parse is only ever returned as `trusted` if it TIES OUT (implied class totals ≈
// reported shares outstanding) and passes structure sanity. If it fails, the caller MUST fall back to the
// FMP ownership-structure summary (float % + insider Form-4). Never render an unvalidated parse — that was
// the /api/segments failure. No route, no deck wiring here (Stage 3). Reads process.env.FMP_KEY.

const UA = { 'User-Agent': 'EasyMA research beckhamwilson@gmail.com' };
const FMP = 'https://financialmodelingprep.com/stable';
const FMP_KEY = process.env.FMP_KEY || '';

async function jget(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
async function tget(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }

const decode = (s) => s
  .replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
  .replace(/&#8217;|&rsquo;|&#8216;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/&#8212;|&mdash;|&#8211;|&ndash;/g, '-').replace(/&#\d+;/g, ' ');
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// ── EDGAR: resolve CIK + find latest DEF 14A ───────────────────────────────────────────────────────────
let _tickerMap = null;
async function cikForTicker(ticker) {
  if (!_tickerMap) {
    const j = await jget('https://www.sec.gov/files/company_tickers.json');
    _tickerMap = {};
    Object.values(j).forEach((e) => { _tickerMap[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, '0'); });
  }
  return _tickerMap[ticker.toUpperCase()] || null;
}

async function findLatestDef14a(cik) {
  const j = await jget(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const f = j.filings.recent;
  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === 'DEF 14A') {
      const acc = f.accessionNumber[i].replace(/-/g, '');
      return { url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${acc}/${f.primaryDocument[i]}`, date: f.filingDate[i] };
    }
  }
  return null; // foreign private issuers (20-F filers) / no proxy → caller falls back
}

// ── Table extraction (nesting-aware) ────────────────────────────────────────────────────────────────────
function allTables(html) {
  const out = []; const stack = []; const re = /<table\b|<\/table>/gi; let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') { const s = stack.pop(); if (s != null && stack.length === 0) out.push({ start: s, end: m.index + 8, html: html.slice(s, m.index + 8) }); }
    else stack.push(m.index);
  }
  return out; // top-level tables only
}

// Ordered cells of a <tr> WITH column positions (colspan-aware) — the key to surviving collapsed padding cells.
function rowCells(rowHtml) {
  const cells = []; let col = 0;
  const parts = rowHtml.split(/<t[dh][\s>]/i).slice(1);
  for (const part of parts) {
    const gt = part.indexOf('>');
    const attrs = gt >= 0 ? part.slice(0, gt) : '';
    const cs = (attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [])[1];
    const colspan = cs ? parseInt(cs, 10) : 1;
    const body = (gt >= 0 ? part.slice(gt + 1) : part).split(/<\/t[dh]>/i)[0];
    cells.push({ col, colspan, text: stripTags(body) });
    col += colspan;
  }
  return cells;
}

// ── Locator: the ownership table = the top-level table whose header carries the beneficial-ownership
// signature AND has the most holder rows. Heading-independent (fixes CRM's inline-tag-split title). ─────────
function findOwnershipTable(html) {
  let best = null, bestScore = -1;
  for (const t of allTables(html)) {
    const headTxt = stripTags(t.html.slice(0, 2500)).toLowerCase();
    const fullTxt = stripTags(t.html).toLowerCase();
    const hasShares = /beneficially owned|number of shares|shares owned|amount and nature|\bshares\b/.test(headTxt);
    const hasPct = /%|percent/.test(headTxt);
    if (!(hasShares && hasPct)) continue;
    const shareNums = (t.html.match(/\d{1,3}(?:,\d{3})+/g) || []).length; // holder share counts
    if (shareNums < 2) continue;
    let score = shareNums;
    if (/beneficially owned/.test(fullTxt)) score += 6;
    if (/5%|stockholders|security holders|directors|executive officers/.test(fullTxt)) score += 4;
    if (/name of beneficial|name and address|beneficial owner/.test(headTxt)) score += 3;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// ── Parse the located table ─────────────────────────────────────────────────────────────────────────────
function parseTable(tableHtml) {
  const rows = tableHtml.split(/<tr[\s>]/i).slice(1).map(rowCells);
  const headBlob = rows.slice(0, 6).map((cs) => cs.map((c) => c.text).join(' ')).join(' ').toLowerCase();
  const dual = /class\s*a/.test(headBlob) && /class\s*b/.test(headBlob);

  // Column anchors from the header rows: where Class A / Class B / Voting blocks begin.
  let colA = null, colB = null, colV = null;
  for (const cs of rows.slice(0, 6)) {
    for (const c of cs) {
      const t = c.text.toLowerCase();
      if (/^class\s*a/.test(t) && colA == null) colA = c.col;
      if (/^class\s*b/.test(t) && colB == null) colB = c.col;
      if (/voting\s*power|total\s*voting/.test(t) && colV == null) colV = c.col;
    }
  }
  // Single-class: first value block after the name is "shares", then "%".
  const num = (s) => { const n = parseInt(String(s).replace(/[,()]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  const isShareTok = (t) => /^\(?\d{1,3}(,\d{3})+\)?$/.test(t) || /^\d{4,}$/.test(t);
  const pctTok = (t) => { const x = t.replace('%', '').trim(); if (t === '*') return '*'; if (/^-+$/.test(t)) return '-'; return /^\d+(\.\d+)?$/.test(x) && parseFloat(x) <= 100 ? parseFloat(x) : null; };

  // reduce a set of block cells to {shares, pct}
  const block = (cells) => {
    let shares = null, pct = null;
    // recombine bare '%' into preceding
    const toks = []; for (const c of cells) { const t = c.text; if (!t || t === '/') continue; if (t === '%' && toks.length) toks[toks.length - 1] += '%'; else toks.push(t); }
    for (const t of toks) { if (shares == null && isShareTok(t)) shares = num(t); else if (pct == null) { const p = pctTok(t); if (p != null) pct = p; } }
    return { shares, pct };
  };

  const holders = []; let section = 'holders';
  for (const cs of rows) {
    const firstText = cs.map((c) => c.text).find((x) => /[A-Za-z]/.test(x)) || '';
    const rowTxt = cs.map((c) => c.text).join(' ');
    if (/(5%|five percent).{0,20}(stockholders|holders|owners)|security holders|executive officers and directors|neos and directors|directors and (named )?executive|management/i.test(rowTxt) && !isShareTok(cs.find((c) => c.text)?.text || '')) {
      if (/5%|five percent|security holders/i.test(rowTxt)) section = '5% holder';
      else if (/director|officer|management|neo/i.test(rowTxt)) section = 'insider';
    }
    if (/name of beneficial|shares beneficially|^class|percent of class|% of total|^shares$|^%$/i.test(firstText)) continue;
    if (!/[A-Za-z]/.test(firstText) || firstText.replace(/[^A-Za-z]/g, '').length < 3) continue;

    const nameCells = cs.filter((c) => (dual ? c.col < (colA ?? 3) : true) && /[A-Za-z]/.test(c.text));
    const name = (nameCells[0]?.text || firstText).replace(/\s*\(\d+\)\s*$/, '').trim();
    if (/^(name|total|shares|class)/i.test(name)) continue;

    let rec = { name, section };
    if (dual && colA != null && colB != null) {
      const bEnd = colV != null ? colV : 1e9;
      const a = block(cs.filter((c) => c.col >= colA && c.col < colB));
      const b = block(cs.filter((c) => c.col >= colB && c.col < bEnd));
      const vCells = colV != null ? cs.filter((c) => c.col >= colV) : [];
      let vote = null; for (const c of vCells) { const p = pctTok(c.text === '%' ? '' : c.text); if (typeof p === 'number') { vote = p; break; } if (c.text.includes('%')) { const p2 = pctTok(c.text); if (typeof p2 === 'number') { vote = p2; break; } } }
      rec.classA = a.shares; rec.pctA = a.pct; rec.classB = b.shares; rec.pctB = b.pct; rec.votingPct = vote;
      rec.shares = (a.shares || 0) + (b.shares || 0) || null;
    } else {
      // single-class: name then first block = shares/%
      const valCells = cs.filter((c) => /[\d*%-]/.test(c.text) && !/[A-Za-z]{3,}/.test(c.text));
      const v = block(valCells);
      rec.shares = v.shares; rec.pct = v.pct;
    }
    if (rec.shares != null || rec.classA != null || rec.classB != null || (rec.pct && rec.pct !== '-')) holders.push(rec);
  }
  return { dualClass: dual, cols: { colA, colB, colV }, holders };
}

// ── Validation gate ─────────────────────────────────────────────────────────────────────────────────────
function validate(parsed, outstandingShares) {
  const named = parsed.holders.filter((h) => h.name && h.name.length > 2);
  if (named.length < 2) return { trusted: false, reason: 'too few named holders parsed' };
  // implied class totals from a holder with both shares and a numeric %
  const impliedFrom = (sharesKey, pctKey) => {
    for (const h of parsed.holders) { const s = h[sharesKey], p = h[pctKey]; if (s > 0 && typeof p === 'number' && p >= 0.5) return s / (p / 100); }
    return null;
  };
  let impliedTotal = null, tieDetail = '';
  if (parsed.dualClass) {
    const aTot = impliedFrom('classA', 'pctA');
    // Class B total: a founder shown at 50% or 100%, or the group row's Class B (usually 100% insider-held)
    let bTot = impliedFrom('classB', 'pctB');
    if (!bTot) { const grp = parsed.holders.find((h) => /group|all (current )?(executive|directors)/i.test(h.name)); if (grp?.classB && grp?.pctB) bTot = grp.classB / (grp.pctB / 100); }
    if (aTot && bTot) { impliedTotal = aTot + bTot; tieDetail = `Class A ~${Math.round(aTot).toLocaleString()} + Class B ~${Math.round(bTot).toLocaleString()}`; }
  } else {
    const t = impliedFrom('shares', 'pct'); if (t) { impliedTotal = t; tieDetail = `implied total ~${Math.round(t).toLocaleString()}`; }
  }
  if (!impliedTotal) return { trusted: false, reason: 'no holder with numeric % to derive tie-out' };
  if (!(outstandingShares > 0)) return { trusted: false, reason: 'no shares-outstanding to tie against' };
  const err = Math.abs(impliedTotal - outstandingShares) / outstandingShares;
  const ok = err <= 0.12; // 12% tolerance (footnote share counts / float dates differ)
  return {
    trusted: ok, reason: ok ? 'tie-out within tolerance' : `tie-out off by ${(err * 100).toFixed(1)}%`,
    impliedTotal: Math.round(impliedTotal), outstandingShares, tieErrPct: +(err * 100).toFixed(1), tieDetail,
  };
}

// ── FMP fallback: ownership STRUCTURE (float) + recent insider Form-4 activity ───────────────────────────
async function fmpOwnershipSummary(ticker) {
  const out = { source: 'fmp-fallback', ticker, float: null, insiders: [], note: 'Detailed beneficial-ownership table unavailable for this filer; showing reported ownership structure.' };
  try {
    const fl = await jget(`${FMP}/shares-float?symbol=${encodeURIComponent(ticker)}&apikey=${FMP_KEY}`).catch(() => null);
    const f = Array.isArray(fl) ? fl[0] : fl;
    if (f && f.outstandingShares > 0) {
      out.float = { outstandingShares: f.outstandingShares, floatShares: f.floatShares, freeFloatPct: f.freeFloat, restrictedPct: f.freeFloat != null ? +(100 - f.freeFloat).toFixed(2) : null };
    }
  } catch (_) {}
  try {
    const ins = await jget(`${FMP}/insider-trading/search?symbol=${encodeURIComponent(ticker)}&apikey=${FMP_KEY}`).catch(() => []);
    const byName = {};
    (Array.isArray(ins) ? ins : []).forEach((e) => { if (!byName[e.reportingName]) byName[e.reportingName] = { name: e.reportingName, role: e.typeOfOwner, owned: e.securitiesOwned, date: e.transactionDate, type: e.transactionType }; });
    out.insiders = Object.values(byName).slice(0, 12);
  } catch (_) {}
  return out;
}

// ── Orchestrator: parse-and-validate, else fall back ────────────────────────────────────────────────────
async function getShareholderAnalysis(ticker) {
  const t = ticker.toUpperCase();
  let outstanding = null;
  try { const fl = await jget(`${FMP}/shares-float?symbol=${encodeURIComponent(t)}&apikey=${FMP_KEY}`).catch(() => null); const f = Array.isArray(fl) ? fl[0] : fl; if (f) outstanding = f.outstandingShares; } catch (_) {}
  try {
    const cik = await cikForTicker(t);
    if (!cik) return { ...(await fmpOwnershipSummary(t)), trusted: false, reason: 'no EDGAR CIK (foreign/unlisted)', parse: null };
    const filing = await findLatestDef14a(cik);
    if (!filing) return { ...(await fmpOwnershipSummary(t)), trusted: false, reason: 'no DEF 14A (20-F filer / no proxy)', parse: null };
    const html = await tget(filing.url);
    const tbl = findOwnershipTable(html);
    if (!tbl) return { ...(await fmpOwnershipSummary(t)), trusted: false, reason: 'ownership table not located', filing };
    const parsed = parseTable(tbl.html);
    const val = validate(parsed, outstanding);
    if (val.trusted) return { source: 'def14a', ticker: t, trusted: true, filing, dualClass: parsed.dualClass, holders: parsed.holders, validation: val };
    return { ...(await fmpOwnershipSummary(t)), trusted: false, reason: `parse untrusted: ${val.reason}`, filing, validation: val, parsedPreview: parsed.holders.slice(0, 4) };
  } catch (e) {
    return { ...(await fmpOwnershipSummary(t)), trusted: false, reason: `error: ${e.message}` };
  }
}

module.exports = { getShareholderAnalysis, findOwnershipTable, parseTable, validate, fmpOwnershipSummary, findLatestDef14a, cikForTicker };
