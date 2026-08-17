// server/services/validator.js
// Phase 4 of the document pipeline: the VALIDATOR. Pure JS, NO LLM in the checks themselves.
//
// It runs internal-consistency + sanity checks over an extraction. On a failed check it issues ONE
// targeted retry to the extractor (a re-transcription of the offending cell — the ONLY place an LLM is
// touched). If the check still fails, the offending field's status becomes 'missing' so it renders as
// an em-dash, NEVER as 0. It NEVER auto-repairs: it will not compute a figure from other figures and
// write it back. A failed check flags a field; it does not fix it.

const { SCALE_FACTOR } = require('./extractorAgent');

const ABS_TOL = 1;                 // arithmetic ties: allow 1 unit (reporting-scale rounding)
const YOY_MAX = 10;                // no single line item may jump >10x year over year
const MARGIN_LO = -1, MARGIN_HI = 1;   // margins must sit within [-100%, 100%]
const REV_MIN = 1e6, REV_MAX = 1e12;   // scaled revenue must be between $1M and $1T

const norm = s => String(s || '').trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

// label matchers (matched against the strictly-verbatim label)
const M = {
  revenue:  n => ['revenues', 'revenue', 'total revenues', 'net revenues', 'net sales', 'total revenue'].includes(n),
  cogs:     n => /^cost of (revenues?|sales|goods sold)$/.test(n),
  gross:    n => n === 'gross profit' || n === 'gross margin',
  // one-step total (Revenue − this = Operating income). Does NOT include "total operating expenses",
  // which on a two-step statement is subtracted from GROSS PROFIT, not from revenue.
  totCostsOneStep: n => ['total costs and expenses', 'total costs and operating expenses', 'total operating costs and expenses'].includes(n),
  totOpEx:  n => n === 'total operating expenses',
  opInc:    n => ['income from operations', 'operating income', 'operating income (loss)', 'loss from operations'].includes(n),
  netInc:   n => ['net income', 'net income (loss)', 'net loss'].includes(n),
  assets:   n => n === 'total assets',
  liab:     n => n === 'total liabilities',
  equity:   n => /^total (stockholders'|shareholders')? ?equity$/.test(n) || n === "total stockholders' equity" || n === "total shareholders' equity",
};

const periodsOf = items => [...new Set(items.map(i => i.periodLabel))].sort();
const find = (items, matcher, period) =>
  items.find(i => i.periodLabel === period && i.status === 'ok' && matcher(norm(i.verbatimLabel)));

// ── the checks (pure JS) ────────────────────────────────────────────────────────
// Each returns { name, status:'pass'|'fail'|'na', detail, failures:[{item, reason, expected, got, period}] }
function runChecks(items, facts) {
  const periods = periodsOf(items);
  const results = [];

  // helper: an arithmetic tie "a - b = c" (or "a = b + c"), offender = the derived subtotal `c`/`a`
  const tie = (name, aM, bM, cM, mode) => {
    let applicable = false; const failures = []; const detail = [];
    for (const p of periods) {
      const a = find(items, aM, p), b = find(items, bM, p), c = find(items, cM, p);
      if (!a || !b || !c) continue;
      applicable = true;
      const expected = mode === 'sub' ? a.value - b.value : b.value + c.value;   // sub: a-b=c ; add: a=b+c
      const got = mode === 'sub' ? c.value : a.value;
      const offender = mode === 'sub' ? c : a;
      if (Math.abs(expected - got) > ABS_TOL) {
        failures.push({ item: offender, period: p, reason: `${name} tie broken`, expected, got });
        detail.push(`${p}: expected ${expected}, got ${got}`);
      } else detail.push(`${p}: ${got} ✓`);
    }
    return { name, status: !applicable ? 'na' : failures.length ? 'fail' : 'pass', detail: detail.join(' | '), failures };
  };

  // 1. Revenue - COGS = stated gross profit  (only if a gross-profit line is printed)
  results.push(tie('grossProfit = revenue - COGS', M.revenue, M.cogs, M.gross, 'sub'));

  // 2. Operating income — written for BOTH income-statement shapes (Bug 6):
  //    two-step: Gross profit − Total operating expenses = Operating income   (NVDA, HD, AAPL)
  //    one-step: Revenue − Total costs and expenses     = Operating income   (KO, MCD, …)
  //    Never Revenue − "total operating expenses" (the old bug that nulled correct two-step EBIT).
  {
    let applicable = false; const failures = []; const detail = [];
    for (const p of periods) {
      const op = find(items, M.opInc, p); if (!op) continue;
      const gp = find(items, M.gross, p), opex = find(items, M.totOpEx, p);
      const rev = find(items, M.revenue, p), tc = find(items, M.totCostsOneStep, p);
      let expected = null, basis = '';
      if (gp && opex) { expected = gp.value - opex.value; basis = 'gross profit − total operating expenses'; }
      else if (rev && tc) { expected = rev.value - tc.value; basis = 'revenue − total costs and expenses'; }
      else continue;   // structure not verifiable → skip this period (NA), never fail on a mismatched shape
      applicable = true;
      if (Math.abs(expected - op.value) > ABS_TOL) { failures.push({ item: op, period: p, reason: `operating-income tie (${basis})`, expected, got: op.value }); detail.push(`${p}: exp ${expected} got ${op.value}`); }
      else detail.push(`${p}: ${op.value} ✓ (${basis})`);
    }
    results.push({ name: 'operating income tie', status: !applicable ? 'na' : failures.length ? 'fail' : 'pass', detail: detail.join(' | ') || 'n/a', failures });
  }

  // 3. Assets = liabilities + equity
  results.push(tie('assets = liabilities + equity', M.assets, M.liab, M.equity, 'add'));

  // 4. Segments sum to total (only when a segment structure is supplied by the caller)
  {
    const segs = facts.segments;   // { period -> {parts:[num], total:num, totalItem, partItems:[] } }
    let applicable = false; const failures = []; const detail = [];
    for (const p of Object.keys(segs || {})) {
      const s = segs[p]; if (!s || !Array.isArray(s.parts) || s.total == null) continue;
      applicable = true;
      const sum = s.parts.reduce((a, x) => a + x, 0);
      if (Math.abs(sum - s.total) > ABS_TOL) { failures.push({ item: s.totalItem || null, period: p, reason: 'segments do not sum to total', expected: s.total, got: sum }); detail.push(`${p}: parts ${sum} vs total ${s.total}`); }
    }
    results.push({ name: 'segments sum to total', status: !applicable ? 'na' : failures.length ? 'fail' : 'pass', detail: detail.join(' | '), failures });
  }

  // 5. Margin band: net & operating margins within [-100%, 100%]
  {
    let applicable = false; const failures = []; const detail = [];
    for (const p of periods) {
      const rev = find(items, M.revenue, p); if (!rev || !rev.value) continue;
      for (const [mM, tag] of [[M.netInc, 'net'], [M.opInc, 'operating'], [M.gross, 'gross']]) {
        const it = find(items, mM, p); if (!it) continue;
        applicable = true;
        const m = it.value / rev.value;
        if (m < MARGIN_LO || m > MARGIN_HI) { failures.push({ item: it, period: p, reason: `${tag} margin out of band`, expected: '[-100%,100%]', got: `${(m * 100).toFixed(1)}%` }); detail.push(`${p} ${tag}: ${(m * 100).toFixed(1)}%`); }
      }
    }
    results.push({ name: 'margin band [-100%,100%]', status: !applicable ? 'na' : failures.length ? 'fail' : 'pass', detail: detail.join(' | ') || 'all in band', failures });
  }

  // 6. No >10x YoY jump on any single monetary line item
  {
    const failures = []; const detail = [];
    const key = i => `${i.parentLabel}||${i.verbatimLabel}`;
    const groups = new Map();
    for (const i of items) { if (i.labelPerShare || i.status !== 'ok') continue; (groups.get(key(i)) || groups.set(key(i), []).get(key(i))).push(i); }
    for (const [, arr] of groups) {
      const seq = arr.slice().sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
      for (let k = 1; k < seq.length; k++) {
        const older = seq[k - 1].value, newer = seq[k].value;
        if (older == null || newer == null || Math.abs(older) < 1) continue;   // skip near-zero denominators
        const ratio = Math.abs(newer / older);
        if (ratio > YOY_MAX) { failures.push({ item: seq[k], period: seq[k].periodLabel, reason: `>${YOY_MAX}x YoY jump on "${seq[k].verbatimLabel}"`, expected: `<=${YOY_MAX}x`, got: `${ratio.toFixed(1)}x` }); detail.push(`${seq[k].verbatimLabel} ${seq[k-1].periodLabel}->${seq[k].periodLabel}: ${ratio.toFixed(1)}x`); }
      }
    }
    results.push({ name: `no >${YOY_MAX}x YoY jump`, status: failures.length ? 'fail' : 'pass', detail: detail.join(' | ') || 'ok', failures });
  }

  // 7. Scale sanity: scaled revenue between $1M and $1T
  {
    const revs = periods.map(p => find(items, M.revenue, p)).filter(Boolean);
    if (!revs.length) results.push({ name: 'scale sanity: $1M ≤ revenue ≤ $1T', status: 'na', detail: 'no revenue line', failures: [] });
    else {
      const top = revs.reduce((a, b) => (Math.abs(b.scaledValue) > Math.abs(a.scaledValue) ? b : a));
      const ok = Math.abs(top.scaledValue) >= REV_MIN && Math.abs(top.scaledValue) <= REV_MAX;
      results.push({ name: 'scale sanity: $1M ≤ revenue ≤ $1T', status: ok ? 'pass' : 'fail', detail: `max scaled revenue = ${top.scaledValue}`, failures: ok ? [] : [{ item: top, period: top.periodLabel, reason: 'scaled revenue outside $1M..$1T', expected: `[${REV_MIN},${REV_MAX}]`, got: top.scaledValue }] });
    }
  }

  // 8. Locator scale fact vs model per-share flag: they must agree
  {
    const failures = []; const detail = [];
    for (const i of items) {
      if (i.status !== 'ok') continue;
      if (i.labelPerShare !== i.modelPerShareFlag)
        failures.push({ item: i, period: i.periodLabel, reason: `per-share disagreement: printed label says ${i.labelPerShare}, model flag says ${i.modelPerShareFlag}`, expected: i.labelPerShare, got: i.modelPerShareFlag });
      else if (i.labelPerShare && !facts.exceptPerShare)
        failures.push({ item: i, period: i.periodLabel, reason: `per-share row present but locator scale fact has no per-share carve-out (exceptPerShare=false)`, expected: 'exceptPerShare=true', got: false });
    }
    if (failures.length) detail.push(`${failures.length} row(s)`);
    results.push({ name: 'locator scale vs model per-share flag', status: failures.length ? 'fail' : 'pass', detail: detail.join(' ') || 'agree', failures });
  }

  const failures = results.flatMap(r => r.failures.map(f => ({ ...f, check: r.name })));
  return { checks: results.map(({ failures, ...r }) => r), failures };
}

// dedupe offending items (same object identity)
const uniqueItems = failures => [...new Set(failures.map(f => f.item).filter(Boolean))];

// ── orchestration: run checks, ONE targeted retry, then flag survivors 'missing' (never repair) ────
async function validate(extraction, opts = {}) {
  const items = extraction.items;
  const facts = { scale: extraction.scale, exceptPerShare: extraction.exceptPerShare, segments: opts.segments };
  const factor = SCALE_FACTOR[facts.scale] || 1;

  // default retry = a targeted re-extraction, if the caller gave us the page text
  let retry = opts.retry;
  if (!retry && opts.pageText) {
    const { extractField } = require('./extractorAgent');
    retry = (field) => extractField(opts.pageText, extraction.page, field, facts);
  }

  let run = runChecks(items, facts);
  const retried = [];

  if (run.failures.length && retry) {
    for (const it of uniqueItems(run.failures)) {
      let nv = null;
      try { nv = await retry({ verbatimLabel: it.verbatimLabel, parentLabel: it.parentLabel, periodLabel: it.periodLabel, page: it.page }); } catch { /* retry failed */ }
      retried.push({ field: `${it.verbatimLabel}@${it.periodLabel}`, newValue: nv ? nv.value : null });
      if (nv && nv.value != null) {                       // re-extraction (NOT a computed repair)
        it.value = nv.value;
        it.scaledValue = it.scaleApplied ? it.value * factor : it.value;
        it.retried = true;
      }
    }
    run = runChecks(items, facts);                        // re-validate ONCE
  }

  // survivors of a failed check -> missing. NEVER computed/auto-repaired.
  const missing = uniqueItems(run.failures);
  for (const it of missing) { it.status = 'missing'; it.value = null; it.scaledValue = null; }

  return {
    ok: run.failures.length === 0,
    checks: run.checks,
    failures: run.failures.map(({ item, ...f }) => ({ ...f, field: item ? `${item.verbatimLabel}@${item.periodLabel}` : null })),
    retried,
    missingFields: missing.map(i => `${i.verbatimLabel}@${i.periodLabel}`),
    items,
  };
}

module.exports = { validate, runChecks };
