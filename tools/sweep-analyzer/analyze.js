// STAGE 10 sweep v2 — ANALYZE. Deterministic recompute pass over the durable raw
// records. Per pair: parse RENDERED figures from the captured deck, recompute the
// checklist from the independent oracle (/quote,/api/price) + the app's own parsed
// deal terms, print inputs·mine·rendered·delta, emit the 24 numbered items, collect
// structured findings. Appends a per-pair block to /tmp/sweep_v2_findings.md.
const fs = require('fs');
const path = require('path');
const AL = require('./allowlist');
// Captures default to the committed set; override with RAW_DIR. Outputs default to /tmp; override with OUT / FLAGS.
const RAW = process.env.RAW_DIR || path.join(__dirname, '..', '..', 'docs', 'sweep-v2', 'captures');
const OUT = process.env.OUT || '/tmp/sweep_v2_findings.md';
const FLAGS = process.env.FLAGS || '/tmp/sweep_v2_flags.json';
const EXPECTED_OUT = process.env.EXPECTED || '/tmp/sweep_v2_expected.json';
const TOL = 0.005;        // 0.5% recompute tolerance

// ---------- parsers ----------
const clean = s => (s == null ? '' : String(s));
// money → $M (handles $, commas, (neg), trailing B→×1000 / M→×1). '—','N/A','n/m','-','$0'? →0 real.
function money(tok) {
  if (tok == null) return null;
  let t = clean(tok).trim();
  if (/^(—|-|–|N\/A|n\/m|n\.m\.?)$/i.test(t)) return null;
  let neg = /^\(.*\)$/.test(t); if (neg) t = t.replace(/[()]/g, '');
  t = t.replace(/\$/g, '').replace(/,/g, '').trim();
  let mult = 1;
  const mB = t.match(/^(-?[\d.]+)\s*B$/i); const mM = t.match(/^(-?[\d.]+)\s*M$/i);
  let v;
  if (mB) { v = parseFloat(mB[1]); mult = 1000; }
  else if (mM) { v = parseFloat(mM[1]); }
  else { const m = t.match(/^-?[\d.]+$/); if (!m) return null; v = parseFloat(t); }
  if (!Number.isFinite(v)) return null;
  return (neg ? -v : v) * mult;
}
function mult(tok) { const t = clean(tok).trim(); if (/^(—|-|–|N\/A|n\/m|n\.m\.?)$/i.test(t)) return null; const m = t.match(/(-?[\d.]+)\s*x/i); return m ? parseFloat(m[1]) : null; }
function pct(tok) { const t = clean(tok).trim(); const m = t.match(/(-?[\d.]+)\s*%/); return m ? parseFloat(m[1]) : null; }
// find a label line; return the money token on same line (after label) or the first non-empty next line
function labeled(text, labelRe) {
  const lines = clean(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (labelRe.test(lines[i])) {
      const after = lines[i].replace(labelRe, '').trim();
      const same = after.match(/\(?\$?[\d.,]+\s*[BM]?\)?/);
      if (same && /\d/.test(same[0])) return same[0];
      for (let k = i + 1; k < Math.min(i + 3, lines.length); k++) { const nl = lines[k].trim(); if (/\d/.test(nl)) return nl.match(/\(?\$?[\d.,]+\s*[BM]?\)?/)?.[0] || null; }
    }
  }
  return null;
}
// dashboard TILE: label / ⓘ / value on separate lines. Returns the money value of the FIRST
// NON-LAYOUT line after the label — and null the moment that line is not money.
//
// It used to scan the whole 3-line window for a money match, skipping every line that did not look like
// money. A tile rendering "N/A" — which is exactly what fmtMoneyTable/fmtMoneyAccounting return on a
// null input (deckTokens.js:33,61) — was therefore skipped like a layout glyph, and the scan ran on into
// the NEXT tile and returned ITS value as this one's. Run 20260817-153300: BRK.B's "Acquirer Net Income
// N/A" read Target Net Income $11.3B, so check 11 recomputed 11,300+11,300+1,385-4,012 = $19.97B and
// flagged the deck for honestly rendering "—". The deck was right; the parser invented the input.
// A tile that renders N/A has NO value. That is not the same as the next tile's value.
//
// PARSING, NOT GRADING: what counts as a defect is unchanged. This only stops a fabricated number from
// reaching a check. Classification follows snapshot-diff.js:46, which already models the distinction —
// —/N/A/n/m are a DASH state, distinct from $0 and from blank. Only true layout is skippable (a blank
// line, the ⓘ glyph, a "(Y1)"/"(incl. …)" parenthetical); the first real token decides, and a non-money
// token decides null.
const TILE_LAYOUT = /^(?:|ⓘ|\(Y1\)|\(incl\.[^)]*\))$/;
const TILE_MONEY  = /^[+(]?-?\$[\d.,]+\s*[BM]?\)?$/;
function tileVal(body, labelRe) {
  const lines = clean(body).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
      const v = lines[k].trim();
      if (TILE_LAYOUT.test(v)) continue;                       // layout — keep looking inside THIS tile
      return TILE_MONEY.test(v) ? money(v.replace('+', '')) : null;  // first real token decides
    }
    return null;                                               // window held nothing but layout
  }
  return null;
}
// tab table row: "Label\tACQ\tTGT\tpeer1\tpeer2..." → [acqTok, tgtTok].
// Column order is Metric | Acquirer | Target | peers…, so acquirer = field right after the
// label, target = the one after that. (The old "last two fields" grabbed PEERS on any pair
// that resolved a peer set — the source of the false net-debt/EV/rev deltas.)
function row2(text, labelRe) {
  const line = clean(text).split('\n').find(l => labelRe.test(l) && /\t/.test(l));
  if (!line) return [null, null];
  const parts = line.split('\t');
  const li = parts.findIndex(p => labelRe.test(p));
  if (li >= 0 && parts.length >= li + 3) return [parts[li + 1].trim(), parts[li + 2].trim()];
  const nf = parts.map(s => s.trim()).filter(s => s !== '');
  return nf.length >= 3 ? [nf[1], nf[2]] : [null, null];
}
// §16 verification value for a field (Value Used column): "Field\t✓\t$1.8B\t..." → first money-ish after status
function verifVal(vtext, labelRe) {
  const line = clean(vtext).split('\n').find(l => labelRe.test(l) && /\t/.test(l));
  if (!line) return null;
  const parts = line.split('\t').map(s => s.trim());
  // parts: [Field, Status, ValueUsed, EDGAR, ...] — ValueUsed is index 2 usually
  for (let i = 2; i < parts.length; i++) { const m = money(parts[i].replace(/★|FY\d+/g, '')); if (m != null) return m; }
  return null;
}
// §6/§7 standalone P&L are TAB rows: Line | FY-3 | FY-2 | FY-1 | LTM | FY+1E | FY+2E | FY+3E.
// Return the LTM-column token (4th value after the label).
function plLTM(text, labelRe) {
  const line = clean(text).split('\n').find(l => labelRe.test(l) && /\t/.test(l));
  if (!line) return null;
  const p = line.split('\t'); const li = p.findIndex(z => labelRe.test(z));
  return li >= 0 && p.length >= li + 5 ? p[li + 4].trim() : null;
}
// §8 proforma is LINE-based (label alone on its line, then column values on the next non-empty lines):
// [Acq, Tgt, Comb, Syn, PF]. Returns the first (nearest forward) year block.
function pfCols(text, labelRe) {
  const lines = clean(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (labelRe.test(t) && !/\d/.test(t)) {   // a LABEL line (no digits); proforma labels carry suffixes " e" / " %"
      const vals = [];
      for (let k = i + 1; k < lines.length && vals.length < 5; k++) {
        const v = lines[k].trim(); if (v === '') continue;
        if (/^(Revenue|Cost of Revenue|Gross Profit|Gross margin|Operating|EBIT|Net Income|Revenue growth|FY20|Line|Acq\.|Less|Operating synergies)/i.test(v)) break;
        vals.push(v);
      }
      return vals;
    }
  }
  return [];
}
// classify a rendered cell — "—" (missing) and "n/m" (deliberate) are DIFFERENT states.
function stateOf(tok) {
  const t = clean(tok).trim();
  if (t === '') return 'ABSENT';
  if (/n\/?m/i.test(t)) return 'NM';
  if (/⚠/.test(t)) return 'FLAGGED';
  if (/^(—|–|-)$/.test(t)) return 'DASH';
  if (/\d/.test(t)) return 'VALUE';
  return 'OTHER';
}
const rel = (mine, rend) => (mine == null || rend == null || rend === 0) ? null : (mine - rend) / Math.abs(rend);
const fnum = v => v == null ? 'null' : (Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(2) + 'B' : '$' + v.toFixed(0) + 'M');
const fpct = r => r == null ? 'n/a' : (r * 100).toFixed(2) + '%';

// ---------- per-pair analysis ----------
function analyze(rec) {
  const F = [];                       // structured findings
  const EXP = [];                     // by-design suppressions absorbed by the allowlist
  const L = [];                       // 24-item lines
  const A = rec.oracleA || {}, B = rec.oracleB || {};
  const S = rec.sections || {};
  const txn = S.txnstructure || '', cmp = S.comparables || '', body = rec.bodyText || '';
  const verif = (S.verification || '') + '\n' + (S.verification2 || '');
  const add = (n, s) => L.push(`${n}. ${s}`);
  const flag = (o) => F.push(o);

  if (!rec.ok) { add(1, `Builds? **NO** — ERR@${rec.stage}: ${clean(rec.error).slice(0, 120)}. Pages=${rec.pdfPages ?? '-'}. (recompute N/A — no deck)`);
    flag({ pair: rec.pair, sev: 'build', kind: 'MISSING', conf: 'confirmed', what: `build failed @${rec.stage}: ${clean(rec.error).slice(0,80)}` });
    return { L, F, EXP }; }

  // ----- deal terms (parsed from the app's own render) -----
  const offer = money(labeled(txn, /^Offer\s/i));
  const premRend = pct((txn.split('\n').find(l => /^Premium\s/i.test(l)) || ''));
  const consLine = txn.split('\n').find(l => /Consideration\s+\d+% cash/i.test(l)) || '';
  const cashPct = pct(consLine.match(/(\d+)% cash/) ? consLine.match(/(\d+)% cash/)[1] + '%' : '');
  const equityRend = money(labeled(txn, /^Equity value\s/i));
  const evRend = money(labeled(txn, /^EV\s/i));
  const feesRend = money(labeled(txn, /Transaction fees/i));
  const usesTot = money(labeled(txn, /Total uses/i));
  const srcTot = money(labeled(txn, /Total sources/i));
  const newDebtRend = money(labeled(txn, /New acquisition debt/i));
  const excessRend = money(labeled(txn, /Excess cash on hand used/i));

  // ----- §2 comparables table -----
  const c = {};
  const grab = (key, re, f) => { const [a, t] = row2(cmp, re); c[key] = { a: f(a), t: f(t), aTok: a, tTok: t }; };
  grab('rev', /Revenue \(\$M LTM\)/i, money);
  grab('equity', /Equity Value \(\$M current\)/i, money);
  grab('netdebt', /Net Debt ?\/ ?\(Cash\)/i, money);
  grab('ev', /Enterprise Value \(\$M current\)/i, money);
  grab('cash', /Cash & Equiv/i, money);
  grab('evrev', /EV ?\/ ?Revenue/i, mult);
  grab('evebitda', /EV ?\/ ?EBITDA/i, mult);
  grab('pe', /P ?\/ ?E \(LTM\)/i, mult);
  grab('gm', /Gross Margin/i, pct);
  grab('rgrowth', /Revenue Growth/i, pct);
  // §6/§7/§8 section handles for cross-surface checks
  const plA = S.plAcquirer || '', plB = S.plTarget || '', pf = S.proforma || '';

  // ----- §16 verification: total debt / cash used (per company; both pages concatenated) -----
  const verifDebt = verifVal(verif, /Total Debt/i);
  const verifCashV = verifVal(verif, /Cash & Equiv/i);

  // ===== BUILD =====
  // A lone 429 console error is the benign /api/nongaap LLM limiter (deck builds complete on GAAP). Only
  // a pageError, or a NON-429 console error, is a real defect.
  const nonBenignConsole = (rec.consoleErrors || []).filter(e => !/429|Too Many/i.test(e));
  const benign429 = (rec.consoleErrors || []).length > 0 && nonBenignConsole.length === 0;
  add(1, `Builds? YES · pages=${rec.pdfPages} · consoleErrors=${(rec.consoleErrors || []).length}${benign429 ? ' (benign nongaap-429; GAAP fallback)' : ''}${nonBenignConsole.length ? ' [' + nonBenignConsole.slice(0, 2).map(e => e.slice(0, 60)).join(' | ') + ']' : ''} · pageErrors=${(rec.pageErrors || []).length}${(rec.pageErrors || []).length ? ' [' + rec.pageErrors.slice(0, 2).join(' | ') + ']' : ''}`);
  if (nonBenignConsole.length || (rec.pageErrors || []).length) flag({ pair: rec.pair, sev: (rec.pageErrors || []).length ? 'high' : 'mid', kind: 'ERROR', conf: 'confirmed', what: `${(rec.pageErrors || []).length ? 'pageError: ' + rec.pageErrors[0] : 'console: ' + nonBenignConsole[0]}`.slice(0, 160) });
  // 1b — DATA FRESHNESS (control #4): a company presented as current whose latest actual FY / balance sheet is years old.
  const capYear = parseInt((rec.ts || '2026').slice(0, 4), 10);
  for (const [who, X] of [['acquirer', A], ['target', B]]) {
    const fy = X.fiscalYear, bsY = X.balanceSheetAsOf ? parseInt(String(X.balanceSheetAsOf).slice(0, 4), 10) : null;
    const age = fy ? capYear - fy : (bsY ? capYear - bsY : null);
    if (age != null && age >= 2) flag({ pair: rec.pair, sev: 'high', kind: 'WRONG', conf: 'confirmed', root: 'STALE',
      what: `STALE FINANCIALS: ${who} ${X.name || ''} presented as current but latest actual is FY${fy} / bsAsOf ${X.balanceSheetAsOf} — ${age}y old (rev ${fnum(X.revenue)}, NI ${fnum(X.netIncome)}, EPS ${X.eps}). Rendered dataSource sec_edgar.`,
      falsifier: `void if the deck labels it as ${fy}-dated; it presents FY${fy} figures without a staleness marker` });
  }

  // ===== 2. bad tokens =====
  const bad = [];
  for (const [id, t] of Object.entries(S)) {
    for (const re of [/\bNaN\b/g, /\bundefined\b/g, /-?\bInfinity\b/g, /\$\s?(NaN|undefined|null)/g, /(?:NaN|null|undefined)\s*%/g]) {
      let m; re.lastIndex = 0; while ((m = re.exec(t))) bad.push(`${id}:${t.slice(Math.max(0, m.index - 20), m.index + 12).replace(/\s+/g, ' ').trim()}`);
    }
  }
  add(2, `Bad tokens: ${bad.length ? '**' + bad.length + '** — ' + bad.slice(0, 5).join(' · ') : 'none'}`);
  if (bad.length) flag({ pair: rec.pair, sev: 'token', kind: 'WRONG', conf: 'confirmed', what: `bad tokens: ${bad.slice(0, 4).join(' · ')}` });

  // ===== RECOMPUTE 3-17 (target B is the acquired co; multiples on §2 are per-company current) =====
  // helper to print a recompute line + flag on >0.5%
  const chk = (n, label, mine, rend, unit, extra, rawTok) => {
    let r = rel(mine, rend);
    // Display-rounding floors: these recomputes are built from rendered components already rounded to $M / 2dp,
    // so accumulated rounding easily exceeds 0.5% on small values. Absolute floors keep only material deltas.
    if (mine != null && rend != null) {
      if (unit === 'x' && Math.abs(mine - rend) <= 0.05) r = 0;                          // 1-dp multiple
      else if (unit === '' && Math.abs(mine - rend) <= 0.006) r = 0;                      // 2-dp EPS / 4-dp ratio
      else if (unit === '$' && Math.abs(mine - rend) <= Math.max(3, 0.01 * Math.abs(rend))) r = 0; // ≤$3M or 1% (multi-input sum)
    }
    const line = `${n}. ${label}: inputs ${extra || ''} · mine ${mine == null ? 'null' : (unit === '$' ? fnum(mine) : unit === 'x' ? mine.toFixed(2) + 'x' : mine.toFixed(2) + (unit || ''))} · rendered ${rend == null ? 'null/—' : (unit === '$' ? fnum(rend) : unit === 'x' ? rend.toFixed(2) + 'x' : rend.toFixed(2) + (unit || ''))} · Δ ${fpct(r)}`;
    L.push(line);
    if (r != null && Math.abs(r) > TOL) flag({ pair: rec.pair, sev: (/EV|Enterprise|accret|EPS|debt/i.test(label) ? 'high' : 'mid'), kind: 'WRONG', conf: 'probable', what: `${label}: mine ${unit === '$' ? fnum(mine) : mine} vs rendered ${unit === '$' ? fnum(rend) : rend} (Δ ${fpct(r)})` });
    // special: rendered null but data available — SKIP (a) net-debt/EV (dedicated detectors own those) and
    // (b) cells whose raw token is n/m — a DELIBERATE third state (no-D&A EV/EBITDA, negative-base P/E), not missing.
    if (rend == null && mine != null && Math.abs(mine) > 0 && !/Net debt|Current EV/i.test(label) && stateOf(rawTok) !== 'NM')
      flag({ pair: rec.pair, sev: 'high', kind: 'MISSING', conf: 'probable', what: `${label}: rendered "${clean(rawTok) || '—'}" but recompute = ${unit === '$' ? fnum(mine) : mine}` });
  };

  // 3. Net debt (target) = debt − cash − sti ; compare to §2 target net-debt
  const bNetDebtMine = (B.debt != null && B.cash != null) ? (B.debt - (B.cash || 0) - (B.shortTermInvestments || 0)) : null;
  chk(3, 'Net debt (target)', bNetDebtMine, c.netdebt.t, '$', `debt ${B.debt == null ? 'null' : fnum(B.debt)} − cash ${fnum(B.cash)} − sti ${B.shortTermInvestments == null ? '0' : fnum(B.shortTermInvestments)}`);
  // 4. Current EV (target) = livePrice×shares + netDebt ; compare §2 target EV
  const bMktcap = (B.livePrice != null && B.shares != null) ? B.livePrice * B.shares : null;
  const bEVmine = (bMktcap != null && bNetDebtMine != null) ? bMktcap + bNetDebtMine : (bMktcap != null && c.netdebt.t != null ? bMktcap + c.netdebt.t : null);
  chk(4, 'Current EV (target §2)', bEVmine, c.ev.t, '$', `mktcap ${fnum(bMktcap)} (px ${B.livePrice}×${B.shares}sh) + netdebt ${bNetDebtMine == null ? '(oracle null)' : fnum(bNetDebtMine)}`);
  // 5. Equity value (transaction) = offer × target shares ; compare §txn Equity value
  const eqMine = (offer != null && B.shares != null) ? offer * B.shares : null;
  chk(5, 'Equity value (offer×shares)', eqMine, equityRend, '$', `offer ${offer} × shares ${B.shares}`);
  // 6. EV/Revenue (target §2) = EV ÷ ltmRev
  const bLtmRev = (B.ltm && B.ltm.revenue != null) ? B.ltm.revenue : B.revenue;
  const evRevMine = (c.ev.t != null && bLtmRev) ? c.ev.t / bLtmRev : null;
  chk(6, 'EV/Revenue (target §2)', evRevMine, c.evrev.t, 'x', `EV ${fnum(c.ev.t)} ÷ ltmRev ${fnum(bLtmRev)}`, c.evrev.tTok);
  // 7. EV/EBITDA (target §2) = EV ÷ ltmEBITDA
  const bLtmEbitda = (B.ltm && B.ltm.ebitda != null) ? B.ltm.ebitda : B.ebitda;
  const evEbitdaMine = (c.ev.t != null && bLtmEbitda > 0) ? c.ev.t / bLtmEbitda : null;
  chk(7, 'EV/EBITDA (target §2)', evEbitdaMine, c.evebitda.t, 'x', `EV ${fnum(c.ev.t)} ÷ ltmEBITDA ${fnum(bLtmEbitda)}`, c.evebitda.tTok);
  // 8. P/E (target §2 LTM) = livePrice ÷ ltmEPS
  const bLtmEps = (B.ltm && B.ltm.eps != null) ? B.ltm.eps : B.eps;
  const peMine = (B.livePrice != null && bLtmEps > 0) ? B.livePrice / bLtmEps : null;
  chk(8, 'P/E (target §2 LTM)', peMine, c.pe.t, 'x', `px ${B.livePrice} ÷ ltmEPS ${bLtmEps}`, c.pe.tTok);
  // 9. Combined revenue = A.ltmRev + B.ltmRev ; compare §2 rows sum vs any rendered combined
  const aLtmRev = (A.ltm && A.ltm.revenue != null) ? A.ltm.revenue : A.revenue;
  const combRevMine = (aLtmRev != null && bLtmRev != null) ? aLtmRev + bLtmRev : null;
  const combRevRend = (c.rev.a != null && c.rev.t != null) ? c.rev.a + c.rev.t : null;
  chk(9, 'Combined revenue (A+B LTM)', combRevMine, combRevRend, '$', `A ${fnum(aLtmRev)} + B ${fnum(bLtmRev)} (vs §2 ${fnum(c.rev.a)}+${fnum(c.rev.t)})`, c.rev.tTok);
  // 14. Exchange ratio = offer ÷ acquirer price ; parse §exchangeratio "offer 0.xxxx"
  const exRatioRend = (() => { const m = (S.exchangeratio || '').match(/offer\s+([\d.]+)/i); return m ? parseFloat(m[1]) : null; })();
  const exRatioMine = (offer != null && A.livePrice) ? offer / A.livePrice : null;
  chk(14, 'Exchange ratio (offer÷acqPx)', exRatioMine, exRatioRend, '', `offer ${offer} ÷ acqPx ${A.livePrice}`);
  // 14b. stock-leg ratio = the ACTUAL shares issued per target share given the cash/stock mix = offer×stock%/acqPx
  const stockPct = cashPct != null ? 100 - cashPct : null;
  const stockLegMine = (offer != null && A.livePrice && stockPct != null) ? (offer * (stockPct / 100)) / A.livePrice : null;
  const atMarketRend = (() => { const m = (S.exchangeratio || '').match(/At-market ratio \(current\)\s*\n?\s*([\d.]+)/i); return m ? parseFloat(m[1]) : null; })();
  add(14, `Stock-leg ratio (offer×${stockPct}%÷acqPx): mine ${stockLegMine == null ? 'n/a' : stockLegMine.toFixed(4)} (full-stock ratio ${exRatioMine == null ? '?' : exRatioMine.toFixed(4)} × ${stockPct}%) · §10 at-market ratio rendered ${atMarketRend == null ? 'n/a' : atMarketRend}`);
  // 15. Sources total == Uses total
  add(15, `Sources=Uses: sources ${fnum(srcTot)} vs uses ${fnum(usesTot)} · Δ ${fpct(rel(srcTot, usesTot))}${(srcTot != null && usesTot != null && Math.abs(srcTot - usesTot) > 1) ? ' **MISMATCH**' : ' ✓'}`);
  if (srcTot != null && usesTot != null && Math.abs(srcTot - usesTot) > Math.max(1, 0.005 * usesTot)) flag({ pair: rec.pair, sev: 'high', kind: 'WRONG', conf: 'confirmed', what: `Sources ${fnum(srcTot)} ≠ Uses ${fnum(usesTot)}` });
  // 16. New debt = cashConsideration + targetDebtRepaid − excessCash(floored). Recompute vs rendered.
  //    excessCash = uses − newEquity − newDebt − cashForFees ... simplest: the deck ties Sources=Uses, and
  //    excessCashUsed is a rendered line. Recompute newDebt = cashConsid + tgtDebtRepaid − excessCashUsed (floored 0).
  const cashConsid = (eqMine != null && cashPct != null) ? eqMine * (cashPct / 100) : null;
  const tgtDebtRepaid = B.debt != null ? B.debt : 0;
  const newDebtMine = (cashConsid != null && excessRend != null) ? Math.max(0, cashConsid + tgtDebtRepaid - excessRend) : null;
  chk(16, 'New acq. debt (cashConsid+debtRepaid−excessCash)', newDebtMine, newDebtRend, '$', `cashConsid ${fnum(cashConsid)} + tgtDebtRepaid ${fnum(tgtDebtRepaid)} − excessCashUsed ${fnum(excessRend)}`);
  if (B.debt == null && verifDebt != null && verifDebt > 50) add(16, `  ↳ ⚠ target debt null in preferred path → $0 repaid in new-debt build, but §16 shows ${fnum(verifDebt)} (see #20) — new debt understated by ~${fnum(verifDebt)}`);

  // 17. LTM legs
  add(17, `LTM legs: oracle composed LTM rev(B)=${fnum(bLtmRev)} trusted=${B.ltm ? B.ltm.trusted : '?'} · (three-leg split not exposed on /quote → leg-level N/A; tie-out gate = ltm.trusted)`);

  // ===== 10-13 pro-forma / accretion — NUMERIC (read the rendered dashboard fields, not prose) =====
  const negBase = /non-positive EPS base|not meaningful from a non-positive/i.test(body);
  const afterTaxSynRend = tileVal(body, /After-Tax Synergies/i);
  const financingRend = tileVal(body, /After-Tax Financing Cost/i);
  const pfNIRend = tileVal(body, /Pro Forma Net Income/i);
  const pfEPSRend = (() => { const m = body.match(/Pro Forma EPS[\s\S]{0,30}?(\$?-?[\d.]+)/); return m ? parseFloat(m[1].replace('$', '')) : null; })();
  const newSharesRend = (() => { const m = body.match(/New Shares Issued\s*\n?\s*([\d,]+)/i); return m ? parseFloat(m[1].replace(/,/g, '')) : null; })();
  const beforeEPS = (() => { const m = body.match(/Before\s*\n?\s*\$?(-?[\d.]+)/); return m ? parseFloat(m[1]) : ((A.ltm && A.ltm.eps != null) ? A.ltm.eps : A.eps); })();
  // 10 — combined EBITDA = A + B + Y1 syn, vs rendered
  const nonPosEbitdaClaim = /Combined EBITDA is non-positive/i.test(body);
  const synY1 = afterTaxSynRend != null ? afterTaxSynRend / (1 - 0.21) : null; // back out pre-tax Y1 from after-tax
  const combEbitdaMine = (A.ebitda != null && B.ebitda != null) ? A.ebitda + B.ebitda + (synY1 || 0) : null;
  const combEbitdaRend = tileVal(body, /Combined EBITDA \(incl\. Y1 synergies\)/i);
  chk(10, 'Combined EBITDA (A+B+synY1)', combEbitdaMine, combEbitdaRend, '$', `A ${A.ebitda == null ? 'null' : fnum(A.ebitda)} + B ${B.ebitda == null ? 'null' : fnum(B.ebitda)} + synY1 ${synY1 == null ? '?' : fnum(synY1)}`);
  if (combEbitdaRend != null && combEbitdaRend > 0 && nonPosEbitdaClaim) flag({ pair: rec.pair, sev: 'mid', kind: 'WRONG', conf: 'confirmed', root: 'D-ebitdaMsg', what: `dashboard renders Combined EBITDA ${fnum(combEbitdaRend)} (>0) yet the Debt/EBITDA tile says "Combined EBITDA is non-positive" — real cause is null combined DEBT (target debt null), mislabeled`, falsifier: `void if rendered combined EBITDA ≤0; observed ${fnum(combEbitdaRend)}` });
  // 11 — pro forma NI: check the deck's INTERNAL sum (rendered acqNI + tgtNI + syn + financing = rendered PF NI).
  //    financing renders in parens = already negative; syn renders "+$X" = positive. Sum should tie.
  const acqNIrend = tileVal(body, /Acquirer Net Income/i);
  const tgtNIrend = tileVal(body, /Target Net Income/i);
  // Synergy: some structures (banks/crypto) omit the "After-Tax Synergies" TILE and only show a narrative
  // "Year 1 cost synergies of $X" (PRE-tax) — fall back to that and convert to after-tax so the sum is checkable.
  let synForNI = afterTaxSynRend, synSrc = 'tile';
  if (synForNI == null) { const m = body.match(/Year 1 cost synergies of (\$[\d.,]+\s*[BM]?)/i); if (m) { synForNI = money(m[1]) * (1 - 0.21); synSrc = 'narrative×0.79'; } }
  const pfNIComplete = acqNIrend != null && tgtNIrend != null && synForNI != null && financingRend != null;
  const pfNIMine = pfNIComplete ? acqNIrend + tgtNIrend + synForNI + financingRend : null;
  chk(11, 'Pro forma NI (acqNI+tgtNI+syn+fin)', pfNIMine, pfNIRend, '$', `acqNI ${fnum(acqNIrend)} + tgtNI ${fnum(tgtNIrend)} + syn ${fnum(synForNI)}(${synSrc}) + fin ${fnum(financingRend)}${pfNIComplete ? '' : ' [component missing → not checked]'}`);
  if (acqNIrend != null && A.netIncome != null && rel(A.netIncome, acqNIrend) != null && Math.abs(rel(A.netIncome, acqNIrend)) > 0.02) add(11, `  ↳ note: deck acquirer NI ${fnum(acqNIrend)} vs oracle ${fnum(A.netIncome)} (basis/period differs — informational)`);
  // 12 — pro forma EPS = PF NI ÷ PF shares (isolate the division: rendered PF NI ÷ recomputed shares)
  const pfShares = (A.dilutedShares != null && newSharesRend != null) ? A.dilutedShares + newSharesRend : null;
  const pfEPSMine = (pfNIRend != null && pfShares) ? pfNIRend / pfShares : null;
  chk(12, 'Pro forma EPS (PFNI÷PFsh)', pfEPSMine, pfEPSRend, '', `PF NI ${fnum(pfNIRend)} ÷ PF shares ${pfShares == null ? '?' : Math.round(pfShares)} (dil ${A.dilutedShares}+new ${newSharesRend})`);
  // 13 — accretion % = (PF EPS − standalone) / standalone
  const accrMine = (pfEPSRend != null && beforeEPS > 0) ? ((pfEPSRend - beforeEPS) / beforeEPS) * 100 : null;
  const accrRendM = body.match(/Change\s*\n?\s*(N\/A|n\/m|-?[\d.]+%)/i);
  const accrRend = accrRendM ? (/[\d]/.test(accrRendM[1]) ? parseFloat(accrRendM[1]) : null) : null;
  add(13, `Accretion %: mine ${accrMine == null ? 'n/m (base ≤0)' : accrMine.toFixed(1) + '%'} (PF EPS ${pfEPSRend} vs standalone ${beforeEPS}) · rendered "${accrRendM ? accrRendM[1] : '?'}"${negBase ? ' · suppressed by design (neg base)' : ''}${(accrRend != null && accrMine != null && Math.abs(accrMine - accrRend) > 0.2) ? ' **Δ ' + (accrMine - accrRend).toFixed(1) + 'pp**' : ''}`);
  if (accrRend != null && accrMine != null && Math.abs(accrMine - accrRend) > 0.2 && !negBase) flag({ pair: rec.pair, sev: 'high', kind: 'WRONG', conf: 'probable', what: `accretion % rendered ${accrRend}% vs recompute ${accrMine.toFixed(1)}% (PF EPS ${pfEPSRend}, standalone ${beforeEPS})` });

  // ===== SUPPRESSION ALLOWLIST (see ./allowlist.js — a readable, auditable ruleset) =====
  const _alctx = AL.context(rec, A, B, body, negBase);
  const allowlisted = (field) => AL.allowlisted(field, _alctx);
  // cross-surface helper: cells = [{s:'§2',tok}, {s:'§7',tok}, ...]. Flags a VALUE-vs-DASH asymmetry;
  // NM is a deliberate third state, not missing; allowlisted asymmetries are recorded EXPECTED, not flagged.
  function xs(field, cells, extra) {
    const st = cells.map(c => ({ ...c, state: stateOf(c.tok) }));
    const hasVal = st.some(c => c.state === 'VALUE');
    const hasDash = st.some(c => c.state === 'DASH' || c.state === 'FLAGGED');
    const nmCells = st.filter(c => c.state === 'NM');
    const desc = st.map(c => `${c.s}=${c.tok || '∅'}[${c.state}]`).join(' · ');
    if (hasVal && hasDash) {
      const reason = allowlisted(field);
      if (reason) { EXP.push({ pair: rec.pair, field, reason, desc }); return { flagged: false, desc, reason }; }
      flag({ pair: rec.pair, sev: 'high', kind: 'MISSING', conf: 'confirmed', root: 'A-crossSurface',
        what: `${field}: value on one surface, "—" on another — ${desc}${extra ? ' · ' + extra : ''}`,
        falsifier: `void if the "—" surface legitimately lacks the concept (allowlist checked: banks/airlines/no-D&A/neg-base)` });
      return { flagged: true, desc };
    }
    if (nmCells.length && hasVal) { const reason = allowlisted(field); if (reason) EXP.push({ pair: rec.pair, field, reason, desc }); }
    return { flagged: false, desc };
  }

  // ===== 18 — revenue · cost of revenue · gross profit · gross margin (cross-surface) =====
  // target gross profit/margin: §2 (margin) · §7 plTarget (GP, LTM col) · §8 proforma (Tgt col)
  const pfGP = pfCols(pf, /^Gross Profit/i), pfRev = pfCols(pf, /^Revenue$/i), pfGM = pfCols(pf, /^Gross margin/i);
  const r18gp = xs('gross profit (target)', [
    { s: '§2gm', tok: c.gm.tTok }, { s: '§7', tok: plLTM(plB, /Gross Profit/i) }, { s: '§8tgt', tok: pfGP[1] }
  ], `oracle GP(B)=${fnum(B.grossProfit)}`);
  const r18cogs = xs('cost of revenue (target)', [
    { s: '§7', tok: plLTM(plB, /Cost of Revenue/i) }, { s: '§8tgt', tok: (pfCols(pf, /^Cost of Revenue/i)[1]) }
  ]);
  // combined gross margin defect (c): §8 combined GP skips tgt's null but combined revenue keeps tgt revenue
  let cm18 = '';
  const combGMrend = pct(pfGM[2]); const acqGMpf = pct(pfGM[0]);
  if (combGMrend != null && acqGMpf != null && stateOf(pfGP[1]) !== 'VALUE' && stateOf(pfRev[1]) === 'VALUE') {
    const acqGP = money(pfGP[0]), acqRev = money(pfRev[0]), tgtRev = money(pfRev[1]);
    const tgtGMs2 = c.gm.t; // §2 target gross margin %
    const tgtGPrestored = (tgtGMs2 != null && tgtRev != null) ? (tgtGMs2 / 100) * tgtRev : null;
    const correctGM = (acqGP != null && tgtGPrestored != null && acqRev != null && tgtRev != null) ? ((acqGP + tgtGPrestored) / (acqRev + tgtRev)) * 100 : null;
    cm18 = ` · **§8 combined GM ${combGMrend}% skips target GP (null) but keeps target revenue → understated; correct ≈ ${correctGM == null ? '?' : correctGM.toFixed(1)}%**`;
    if (correctGM != null && Math.abs(correctGM - combGMrend) > 1) flag({ pair: rec.pair, sev: 'high', kind: 'WRONG', conf: 'confirmed', root: 'B-nullInSum',
      what: `§8 combined gross margin ${combGMrend}% is understated: numerator = acquirer GP $${acqGP}M only (target GP null/—) but denominator = combined revenue $${acqRev + tgtRev}M (incl. target $${tgtRev}M). Correct ≈ ${correctGM.toFixed(1)}% (target GP restored via §2 margin ${tgtGMs2}%).`,
      falsifier: `void if target genuinely has no gross profit; §2 shows target gross margin ${tgtGMs2}% and /quote grossProfit ${fnum(B.grossProfit)}` });
  }
  add(18, `Rev/COGS/GP/GM cross-surface (target): rev Δ ${fpct(rel(bLtmRev, c.rev.t))} · GP ${r18gp.reason ? 'EXPECTED(' + r18gp.reason.slice(0, 24) + ')' : (r18gp.flagged ? '**ASYMMETRY**' : 'ok')} [${r18gp.desc}] · COGS ${r18cogs.flagged ? '**ASYMMETRY**' : (r18cogs.reason ? 'EXPECTED' : 'ok')}${cm18}`);
  // ===== 19 — operating income · EBITDA · net income · EPS (cross-surface: §7 LTM vs §8 proforma Tgt) =====
  const r19oi = xs('operating income (target)', [{ s: '§7', tok: plLTM(plB, /Operating Income/i) }, { s: '§8tgt', tok: pfCols(pf, /EBIT \(Op Income\)|Operating Income/i)[1] }]);
  const r19ni = xs('net income (target)', [{ s: '§7', tok: plLTM(plB, /Net Income/i) }, { s: '§8tgt', tok: pfCols(pf, /^Net Income/i)[1] }]);
  // EBITDA: §2 carries only the EV/EBITDA MULTIPLE (n/m for negative-EBITDA / no-D&A) — comparing the multiple's
  // presence to §7's EBITDA VALUE is a category error, so this leg is INFORMATIONAL, not flagged.
  const ebTok7 = plLTM(plB, /EBITDA/i);
  add(19, `OpInc/EBITDA/NI/EPS cross-surface (target): OpInc ${r19oi.flagged ? '**ASYM**' : (r19oi.reason ? 'EXP' : 'ok')} · NI ${r19ni.flagged ? '**ASYM**' : (r19ni.reason ? 'EXP' : 'ok')} · EBITDA(info) §7=${ebTok7 || '—'} §2 EV/EBITDA=${c.evebitda.tTok} · EPS §2 P/E=${c.pe.tTok}`);
  const bImpliedDebtFrom2 = (c.netdebt.t != null && c.cash.t != null) ? c.netdebt.t + c.cash.t : null; // netdebt = debt−cash−sti ; +cash ≈ gross debt
  const debtSurfaces = `oracle/quote(pref)=${B.debt == null ? '**null**' : fnum(B.debt)} · §16 verif=${verifDebt == null ? '—' : fnum(verifDebt)} · §2 net-debt-implied gross≈${bImpliedDebtFrom2 == null ? '—' : fnum(bImpliedDebtFrom2)}`;
  // shares + cash cross-surface (wire the previously-unused verifCashV; add §16 shares)
  const verifShares = verifVal(verif, /Shares Outstanding/i);
  const cashSurf = `oracle ${fnum(B.cash)} · §2 ${c.cash.t == null ? c.cash.tTok || '—' : fnum(c.cash.t)} · §16 ${verifCashV == null ? '—' : fnum(verifCashV)}`;
  const sharesSurf = `oracle ${B.shares == null ? '?' : B.shares} · §16 ${verifShares == null ? '—' : verifShares}`;
  add(20, `**Cross-surface (target)** — debt: ${debtSurfaces} · §2 EV=${fnum(c.ev.t)} · §txn EV=${fnum(evRend)} | cash: ${cashSurf} | shares: ${sharesSurf} | mktcap/equity: §2 ${c.equity.tTok}`);
  // cash asymmetry: §2 shows a cash value but §16 "—" (or vice-versa) with a real oracle value
  if (B.cash != null && stateOf(c.cash.tTok) === 'VALUE' && verifCashV == null && /Cash & Equiv/i.test(verif)) { /* §16 cash line exists but unparsed — informational only */ }
  // THE key defect detector: oracle debt null but §16 has real debt → §2/§txn drop it
  if ((B.debt == null || B.debt === 0) && verifDebt != null && verifDebt > 50) {
    // is §2 net debt showing net CASH (debt dropped)?
    const droppedIn2 = c.netdebt.t != null && c.netdebt.t < 0 && Math.abs(c.netdebt.t) < verifDebt;
    const trueNetDebt = verifDebt - (c.cash.t || B.cash || 0);
    const trueEV = (c.equity.t != null) ? c.equity.t + trueNetDebt : null;
    flag({ pair: rec.pair, sev: 'high', kind: 'WRONG', conf: 'confirmed',
      what: `TARGET DEBT DROPPED: /quote debt=${B.debt == null ? 'null' : B.debt} but §16 verif=${fnum(verifDebt)} (sourced). §2 net-debt renders ${c.netdebt.t == null ? '—' : fnum(c.netdebt.t)} (net cash → debt=0). §2 EV ${fnum(c.ev.t)} understates ~${fnum(verifDebt)}; true net debt ≈ ${fnum(trueNetDebt)}, true EV ≈ ${trueEV == null ? '?' : fnum(trueEV)}. §txn EV ${fnum(evRend)} likewise omits it.`,
      falsifier: `void if /quote debt were non-null or §16 value unsourced; both observed` });
  }
  // ── target Equity/EV withheld ("⚠"/"—") detector — categorise by root cause ──
  const evTok = clean(c.ev.tTok), eqTok = clean(c.equity.tTok);
  const evWithheld = /⚠/.test(evTok) || /^—$|^-$/.test(evTok.trim()) || (c.ev.t == null && evTok !== '');
  const oracleEqui = (B.livePrice != null && B.shares != null) ? B.livePrice * B.shares : null;
  const oracleNetDebtOk = B.debt != null && B.cash != null;
  const oracleEVable = oracleEqui != null && oracleNetDebtOk;
  if (evWithheld && oracleEqui != null) {
    if (B.debt == null && !(verifDebt != null && verifDebt > 50)) {
      // debt null everywhere → honest withhold, but still the null-preferred-path shape
      flag({ pair: rec.pair, sev: 'mid', kind: 'MISSING', conf: 'probable', root: 'A-nullPath',
        what: `target EV withheld (§2 EV="${evTok}") — /quote debt=null (net-debt uncomputable); equity itself computable (${fnum(oracleEqui)})`, falsifier: `void if oracle debt were present` });
    } else if (B.cash == null && B.debt != null) {
      flag({ pair: rec.pair, sev: 'mid', kind: 'MISSING', conf: 'probable', root: 'A-nullPath',
        what: `target EV="${evTok}" — /quote cash=null → net-debt/EV uncomputable though debt=${fnum(B.debt)} present; equity shown ${fnum(c.equity.t)}`, falsifier: `void if oracle cash were present` });
    } else if (oracleEVable) {
      // EVERYTHING present (price, shares, debt, cash) yet ⚠ → mktCap-sanity gate (SectionComparables.js:56):
      //   mktCapSane = !((mktCap/rev) < 0.8 && opInc > 0)  → a PROFITABLE co trading < 0.8× revenue is flagged.
      // Over-fires on whole low-multiple sectors (retail/airlines/restaurants/wholesale). Confirmed by the ratio.
      const evShould = oracleEqui + (B.debt - B.cash - (B.shortTermInvestments || 0));
      const rev = (B.ltm && B.ltm.revenue) || B.revenue;
      const ratio = rev ? oracleEqui / rev : null;
      const opInc = (B.ltm && B.ltm.operatingIncome != null) ? B.ltm.operatingIncome : B.operatingIncome;
      const meetsGate = ratio != null && ratio < 0.8 && (opInc || 0) > 0;
      flag({ pair: rec.pair, sev: 'high', kind: 'MISSING', conf: meetsGate ? 'confirmed' : 'probable', root: 'C-mktCapGate',
        what: `target equity & EV render "${evTok}" though fully computable (EV ≈ ${fnum(evShould)}). Cause = mktCap-sanity gate SectionComparables.js:56: mktCap/rev = ${ratio == null ? '?' : ratio.toFixed(2)} < 0.8 AND opInc ${fnum(opInc)} > 0 → flagged "insane". But the low multiple is REAL (bsAsOf ${B.balanceSheetAsOf || '?'}, price current) — the gate over-fires on legitimately low-revenue-multiple businesses.`,
        falsifier: `void if the target price/shares were actually stale/wrong (making mktCap spuriously low); oracle price ${B.livePrice} is the current CNBC price the deck itself uses, and ${(B.name||'target')} genuinely trades < 0.8× sales` });
    }
  }
  // 21 — total assets · accretion · exchange ratio · premium
  const premMine = B.livePrice ? (((offer - B.livePrice) / B.livePrice) * 100) : null;
  const taRendered = /Total [Aa]ssets/.test(plA) || /Total [Aa]ssets/.test(plB) || /Total [Aa]ssets/.test(cmp);
  add(21, `Assets/accretion/exch/premium: total assets oracle A/B ${fnum(A.totalAssets)}/${fnum(B.totalAssets)} (rendered on a comparable surface: ${taRendered ? 'yes' : 'NO — not shown in deck'}) · premium mine ${premMine == null ? '?' : premMine.toFixed(1)}% vs rendered ${premRend}% (Δ ${premMine != null && premRend != null ? (premMine - premRend).toFixed(1) + 'pp' : '?'}) · exch ratio ${exRatioRend} · accretion (see #13) · equity/EV token eq="${eqTok}" ev="${evTok}"${evWithheld && oracleEVable ? ' **WITHHELD despite computable**' : ''}`);
  if (premMine != null && premRend != null && Math.abs(premMine - premRend) > 0.5) flag({ pair: rec.pair, sev: 'mid', kind: 'WRONG', conf: 'probable', what: `premium rendered ${premRend}% vs recompute ${premMine.toFixed(1)}% (offer ${offer} vs price ${B.livePrice})` });

  // ===== 22-24 judgment =====
  // 22 — enumerate the KEY "—"/n/m cells with field·section·why, flag any that HIDE a figure present elsewhere.
  const dashes = [];
  for (const [id, t] of Object.entries(S)) { const n = (t.match(/—/g) || []).length; if (n) dashes.push(`${id}:${n}`); }
  const hides = [];
  if (B.debt == null && verifDebt != null && verifDebt > 50) hides.push(`target debt "—" on §2/§3/§7 but $${fnum(verifDebt)} on §16 (see #20)`);
  if (stateOf(plLTM(plB, /Gross Profit/i)) === 'DASH' && (c.gm.t != null || B.grossProfit != null)) hides.push(`target gross profit "—" on §7 but §2 margin ${c.gm.t}% / oracle GP ${fnum(B.grossProfit)} present (see #18)`);
  if (stateOf(pfCols(pf, /^Gross Profit/i)[1]) === 'DASH' && c.gm.t != null) hides.push(`target gross profit "—" on §8 but §2 margin ${c.gm.t}% present`);
  add(22, `"—" counts by section: ${dashes.join(' ')} · HIDES-A-FIGURE: ${hides.length ? hides.join(' | ') : 'none detected'} · (n/m states are deliberate, not counted as missing)`);
  add(23, `Neg/zero-base claims: acquirer loss-making=${negBase} → accretion % correctly suppressed=${negBase ? 'YES' : 'n/a'} · combined-EBITDA non-positive claim=${nonPosEbitdaClaim}`);
  // sector behaviors
  const isBankPair = /Bank M&A Mode|P ?\/ ?TBV|CET1|efficiency ratio/i.test(body);
  const evSuppressed = c.evebitda.a == null && /bank/i.test(body);
  const fxStated = /exchange rate|→ ?USD|Reported currency|Spot rate|at a stated rate|FX/i.test(body);
  const dcfSuppressed = /DCF (is )?(suppressed|not shown|omitted)|negative equity/i.test(body);
  add(24, `Sector: bankMode=${isBankPair} (EV/EBITDA acq §2=${c.evebitda.a == null ? 'suppressed/—' : c.evebitda.a + 'x'}) · FX-rate-stated=${fxStated} · DCF-suppress-signal=${dcfSuppressed} · neg-equity-signal=${/negative equity/i.test(body)}`);

  return { L, F, EXP };
}

// ---------- driver ----------
const files = (process.argv[2] ? process.argv.slice(2) : fs.readdirSync(RAW).filter(f => f.endsWith('.json')).map(f => `${RAW}/${f}`));
let allF = [], allE = [];
let block = `\n\n<!-- analyzer run ${new Date().toISOString()} -->\n`;
for (const fp of files) {
  let rec; try { rec = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { block += `\n### ${fp} — UNREADABLE: ${e.message}\n`; continue; }
  const { L, F, EXP } = analyze(rec);
  allF = allF.concat(F); allE = allE.concat(EXP || []);
  const Ls = L.slice().sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
  const hdr = `\n### ${rec.pair}${rec.offerOverride ? ' @' + rec.offerOverride : ' (30% default)'} — ts ${rec.ts}\n`;
  block += hdr + Ls.join('\n') + '\n';
  fs.appendFileSync(OUT, hdr + Ls.join('\n') + '\n');
}
// findings sidecar (for ranking)
fs.writeFileSync(FLAGS, JSON.stringify(allF, null, 1));
fs.writeFileSync(EXPECTED_OUT, JSON.stringify(allE, null, 1));
console.log(`analyzed ${files.length} pairs · ${allF.length} raw flags · ${allE.length} allowlist-absorbed → ${FLAGS}`);
const bySev = {}; allF.forEach(f => bySev[f.sev] = (bySev[f.sev] || 0) + 1);
const byRoot = {}; allF.forEach(f => { const r = f.root || 'other'; byRoot[r] = (byRoot[r] || 0) + 1; });
console.log('by severity:', JSON.stringify(bySev));
console.log('by root:', JSON.stringify(byRoot));
// dedupe: distinct (root × what-signature) with reproducing pairs
const distinct = {};
allF.forEach(f => { const key = (f.root || 'other') + '::' + (f.what || '').replace(/[\d.,$%]+/g, '#').slice(0, 60); (distinct[key] = distinct[key] || []).push(f.pair); });
console.log('distinct defect signatures:', Object.keys(distinct).length);
const allowByReason = {}; allE.forEach(e => allowByReason[e.reason] = (allowByReason[e.reason] || 0) + 1);
console.log('allowlist absorbed by reason:', JSON.stringify(allowByReason));
