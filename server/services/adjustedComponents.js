'use strict';
// server/services/adjustedComponents.js — the filed INPUTS of a computed adjusted (non-GAAP) net income and EBITDA, for a
// company whose earnings release has no reconciliation for the period (Fix 13). It resolves inputs only; the arithmetic is
// src/lib/computedAdjusted.js, the one calculation the deck uses.
//
// Each add-back is a filed us-gaap fact:
//   • fiscal year — the 10-K full-year value at the deck's fiscal-year end (ltmCalc.valFullYearAt);
//   • LTM        — ltmCalc.ltmFlow at the same revenue-anchored period keys every other LTM figure uses (annual + latest YTD
//                  − prior YTD). No second LTM method: a concept missing any of the three legs has no LTM value.
// A concept that is not tagged for the period is simply not added, and is listed as not found. Nothing is estimated,
// defaulted or interpolated; an absent value is null, never 0. A tagged 0 is a filed 0 and is listed as found at $0.
//
// The GAAP base figures (net income, operating income, EBITDA = operating income + D&A) are the deck's own: the same values
// /quote returns for the fiscal year and for LTM, so the computed figure starts from the number the slide already shows.
//
// Tax evidence (the rate itself is applied by the calculation):
//   • 'disclosed'            — the company's own non-GAAP tax rate, stated in its fiscal-year earnings release for that
//                              fiscal year (fiscal-year period only);
//   • 'valuation allowance'  — the 10-K tax note states a full valuation allowance on deferred tax assets → no tax effect;
//   • 'default'              — neither: the calculation uses the app's TAX_RATE.

const { ltmFlow, valFullYearAt } = require('./ltmCalc');

// Required: stock-based compensation, the cash-flow statement add-back (the brief's ShareBasedCompensation).
// GAAP pre-tax income (Fix 16): the computed adjusted net income is (pre-tax income + add-backs) × (1 − t).
const PRETAX = { key: 'pretax', label: 'GAAP pre-tax income', concepts: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'] };
const SBC = { key: 'sbc', label: 'stock-based compensation', concepts: ['ShareBasedCompensation'] };

// Added to net income only (it sits inside D&A, which EBITDA already adds back).
const AMORTIZATION = { key: 'amortization', label: 'amortization of acquired intangibles', concepts: ['AmortizationOfIntangibleAssets'] };

// One-time items: added to net income (taxed) and to EBITDA. Within one item the concepts are alternatives, first filed wins,
// so one charge is never counted twice. Aggregate tags that can contain the items below (AssetImpairmentCharges,
// RestructuringCostsAndAssetImpairmentCharges, RestructuringSettlementAndImpairmentProvisions) are deliberately not read.
const ONE_TIME = [
  { key: 'restructuring', label: 'restructuring', concepts: ['RestructuringCharges', 'RestructuringCosts'] },
  { key: 'goodwillImpairment', label: 'goodwill impairment', concepts: ['GoodwillImpairmentLoss'] },
  { key: 'intangibleImpairment', label: 'intangible asset impairment', concepts: ['ImpairmentOfIntangibleAssetsExcludingGoodwill', 'ImpairmentOfIntangibleAssetsFinitelived'] },
  { key: 'longLivedImpairment', label: 'long-lived asset impairment', concepts: ['ImpairmentOfLongLivedAssetsHeldForUse'] },
  { key: 'acquisition', label: 'acquisition-related costs', concepts: ['BusinessCombinationAcquisitionRelatedCosts'] },
  { key: 'integration', label: 'integration costs', concepts: ['BusinessCombinationIntegrationRelatedCosts'] },
  { key: 'litigation', label: 'litigation settlements', concepts: ['LitigationSettlementExpense'] },
];

const toM = (v) => (v == null ? null : v / 1e6);

// One item at the fiscal-year end: the first listed concept with a 10-K full-year value there.
function fyItem(gaap, item, fyEnd) {
  for (const c of item.concepts) {
    const v = valFullYearAt(gaap[c]?.units?.USD || [], fyEnd);
    if (v != null) return { key: item.key, label: item.label, value: toM(v), concept: c };
  }
  return null;
}

// One item over the LTM window, by ltmFlow (it selects the first listed concept that supplies all three legs).
function ltmItem(gaap, item, P) {
  const f = ltmFlow(gaap, item.concepts, P);
  if (f.ltm == null) return null;
  return { key: item.key, label: item.label, value: toM(f.ltm), concept: f.conceptName, legs: { annual: toM(f.annual), latestYTD: toM(f.latestYTD), priorYTD: toM(f.priorYTD) } };
}

// ── Amortization of ACQUIRED intangibles ─────────────────────────────────────────────────────────────────────────────
// AmortizationOfIntangibleAssets is all intangible amortization. Some filers carry capitalized software as an intangible and
// break the total out by FiniteLivedIntangibleAssetsByMajorClassAxis (TDOC FY2025: 350.764 = acquired 183.147 + capitalized
// software 167.617). Where the filing's own instance shows that breakdown for a period, the acquired figure is the filer's
// acquired member, else the total less its software member(s). Where no breakdown is filed, the total is used as filed.
const DAY = 86400000;
const spanDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
function amortizationBreakdown(xml) {
  if (!xml) return [];
  const ctx = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const b = m[2];
    const dims = [...b.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((x) => ({ dim: x[1], member: x[2] }));
    ctx[m[1]] = { start: (b.match(/<(?:xbrli:)?startDate>\s*([0-9-]+)/) || [])[1] || null, end: (b.match(/<(?:xbrli:)?endDate>\s*([0-9-]+)/) || [])[1] || null, dims, typed: /typedMember/.test(b) };
  }
  const byPeriod = new Map();
  for (const m of xml.matchAll(/<us-gaap:AmortizationOfIntangibleAssets\b([^>]*)>\s*(-?[0-9.]+)\s*</g)) {
    const c = ctx[(m[1].match(/contextRef="([^"]+)"/) || [])[1]];
    if (!c || !c.start || !c.end || c.typed) continue;
    const key = `${c.start}..${c.end}`;
    const e = byPeriod.get(key) || { start: c.start, end: c.end, total: null, acquired: null, software: 0, softwareSeen: false, other: false };
    const v = Number(m[2]);
    if (!c.dims.length) e.total = v;
    else if (c.dims.length === 1 && /FiniteLivedIntangibleAssetsByMajorClassAxis$/.test(c.dims[0].dim)) {
      if (/acquired/i.test(c.dims[0].member)) e.acquired = v;
      else if (/software/i.test(c.dims[0].member)) { e.software += v; e.softwareSeen = true; }
    }
    byPeriod.set(key, e);
  }
  return [...byPeriod.values()].filter((e) => e.acquired != null || e.softwareSeen).map((e) => ({
    start: e.start, end: e.end, span: spanDays(e.start, e.end),
    acquired: e.acquired != null ? e.acquired : (e.total != null ? e.total - e.software : null),
    method: e.acquired != null ? 'acquired-intangibles member' : 'total less capitalized-software member',
    total: e.total,
  }));
}
const legAt = (bd, end, span) => bd.find((b) => b.end === end && Math.abs(b.span - span) <= 10) || null;
const fyLegAt = (bd, end) => bd.find((b) => b.end === end && b.span >= 350 && b.span <= 380) || null;

// The amortization item for one period, honouring a filed breakdown. Returns { item } or { item: null, reason }.
function amortizationItem(gaap, bd, period, P) {
  if (period.kind === 'fy') {
    const b = fyLegAt(bd, period.end);
    if (b) return b.acquired == null ? { item: null, reason: 'the acquired-intangibles portion of AmortizationOfIntangibleAssets is not tagged' }
      : { item: { key: AMORTIZATION.key, label: AMORTIZATION.label, value: toM(b.acquired), concept: `${AMORTIZATION.concepts[0]} (${b.method})` } };
    return { item: fyItem(gaap, AMORTIZATION, period.end) };
  }
  const legs = [fyLegAt(bd, P.annualEnd), legAt(bd, P.iEnd, P.span), legAt(bd, P.pEnd, P.span)];
  if (legs.some(Boolean)) {
    if (legs.some((l) => !l || l.acquired == null)) return { item: null, reason: 'AmortizationOfIntangibleAssets includes capitalized software, and the acquired portion is not tagged for all three LTM legs' };
    const [a, l, p] = legs.map((x) => x.acquired);
    return { item: { key: AMORTIZATION.key, label: AMORTIZATION.label, value: toM(a + l - p), concept: `${AMORTIZATION.concepts[0]} (${legs[0].method})`, legs: { annual: toM(a), latestYTD: toM(l), priorYTD: toM(p) } } };
  }
  return { item: ltmItem(gaap, AMORTIZATION, P) };
}

function periodComponents(read, base, period, amort) {
  const sbc = read(SBC);
  const pretax = read(PRETAX);
  const amortization = amort.item;
  const found = [], notFound = [];
  for (const it of ONE_TIME) { const r = read(it); if (r) found.push(r); else notFound.push(it.label); }
  // The deck's own GAAP figures, unrounded where /quote carries them (base.precise, non-enumerable), else as shown ($1M).
  const pr = base.precise || {};
  const val = (k) => (pr[k] != null ? pr[k] : (base[k] ?? null));
  return {
    period,
    netIncome: val('netIncome'),                  // $M, the deck's GAAP net income for this period
    operatingIncome: val('operatingIncome'),
    ebitda: val('ebitda'),                        // $M, GAAP operating income + D&A, as the deck computes it
    baseUnrounded: !!(base.precise && pr.netIncome != null),
    ebitdaReason: base.ebitda == null ? (base.ebitdaReason || 'no GAAP EBITDA (operating income + D&A) for the period') : null,
    pretax: pretax || null,
    pretaxReason: pretax ? null : `GAAP pre-tax income (${PRETAX.concepts[0]}) is not tagged for ${period.label}`,
    sbc: sbc || null,
    sbcReason: sbc ? null : `stock-based compensation (${SBC.concepts[0]}) is not tagged for ${period.label}`,
    amortization: amortization || null,
    amortizationReason: amortization ? null : (amort.reason || `amortization of acquired intangibles (${AMORTIZATION.concepts[0]}) is not tagged for ${period.label}`),
    oneTime: found,
    oneTimeNotFound: notFound,
  };
}

// The 10-K tax note's own statement of a full valuation allowance, or null. Pure: takes the 10-K instance XML.
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x2019;|&#8217;/gi, "'")
  .replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&');
const textOf = (html) => decode(decode(html)).replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const FULL_VA = /\bfull (?:U\.S\. )?valuation allowance\b/i;
const NOT_HELD = /\b(?:releas|revers|no longer|remov|eliminat)/i;
function fullValuationAllowance(instanceXml) {
  if (!instanceXml) return null;
  for (const m of instanceXml.matchAll(/<us-gaap:IncomeTaxDisclosureTextBlock\b[^>]*>([\s\S]*?)<\/us-gaap:IncomeTaxDisclosureTextBlock>/g)) {
    const sentence = textOf(m[1]).split(/(?<=\.)\s+(?=[A-Z])/).find((s) => FULL_VA.test(s) && !NOT_HELD.test(s));
    if (sentence) return sentence.trim();
  }
  return null;
}

// The company's own non-GAAP tax rate for fiscal year `fyEndYear`, stated in its fiscal-year earnings release, or null.
// The sentence must name the rate as non-GAAP and the latest year it names before the rate must be the fiscal year; an
// outlook ("estimated to be", "expect") is a forecast, not the rate the year was computed at. Pure: takes the release HTML.
const NG_RATE = /non-GAAP[^.%]{0,40}?tax rate|tax rate \(non-GAAP\)/i;
const FORWARD = /\b(?:expect|estimated to be|outlook|guidance|anticipate)/i;
function disclosedNonGaapTaxRate(releaseHtml, fyEndYear) {
  if (!releaseHtml || !fyEndYear) return null;
  const text = textOf(releaseHtml);
  for (const s of text.split(/(?<=[.;])\s+(?=[A-Z(])/)) {
    const m = s.match(NG_RATE);
    if (!m || FORWARD.test(s)) continue;
    const after = s.slice(m.index);
    const pm = after.match(/(\(?)(\d{1,2}(?:\.\d+)?)\)?\s?%/);
    if (!pm) continue;
    const prefix = s.slice(0, m.index + pm.index);
    const years = [...prefix.matchAll(/\b(20\d\d)\b/g)].map((y) => Number(y[1]));
    if (!years.length || years[years.length - 1] !== Number(fyEndYear)) continue;
    const rate = (pm[1] === '(' ? -1 : 1) * Number(pm[2]) / 100;
    return { rate, sentence: s.trim().slice(0, 400) };
  }
  return null;
}

// Pure. facts: companyfacts; edgar: the fetchFromEDGAR result (/quote's EDGAR figures, $M); instances: the 10-K's and latest
// 10-Q's XBRL instance text (for the dimensioned amortization breakdown), either may be null. Returns { fy, ltm, reasons }.
function adjustedComponents(facts, edgar, instances = []) {
  const bd = instances.flatMap((x) => amortizationBreakdown(x));
  const gaap = facts?.facts?.['us-gaap'] || {};
  const out = { fy: null, ltm: null, reasons: { fy: null, ltm: null } };
  const fyEnd = edgar?.fiscalYearEnd || null;
  if (!fyEnd) out.reasons.fy = 'no fiscal-year end for the deck year';
  else {
    const fyLabel = `FY${edgar.fiscalYear ?? String(fyEnd).slice(0, 4)}`;
    const period = { kind: 'fy', label: fyLabel, end: fyEnd, source: '10-K full year' };
    out.fy = periodComponents((it) => fyItem(gaap, it, fyEnd), edgar, period, amortizationItem(gaap, bd, period));
  }
  const L = edgar?.ltm;
  const per = L?.trusted ? L.audit?.periods : null;
  if (per && per.annual && per.latestInterim && per.priorInterim) {
    const P = { annualEnd: per.annual.end, iEnd: per.latestInterim.end, pEnd: per.priorInterim.end, span: per.latestInterim.span };
    const period = { kind: 'ltm', label: `LTM to ${L.asOf}`, end: L.asOf, source: `10-K FY to ${P.annualEnd} + 10-Q YTD to ${P.iEnd} − 10-Q YTD to ${P.pEnd}` };
    out.ltm = periodComponents((it) => ltmItem(gaap, it, P), L, period, amortizationItem(gaap, bd, period, P));
  } else if (L?.trusted && out.fy && L.asOf === fyEnd) {
    out.ltm = { ...out.fy, period: { kind: 'ltm', label: `LTM to ${L.asOf}`, end: L.asOf, source: '10-K full year (no later 10-Q yet)' } };
  } else {
    out.reasons.ltm = (L && L.reason) || 'no trusted LTM for this company';
  }
  return out;
}

// The tax rate for one company's computed figure (Fix 16): the company's own non-GAAP tax rate when its earnings release states
// one (the fiscal-year release for FY; the latest quarterly release for LTM, server.js), else the app's TAX_RATE. A full
// valuation allowance is not a reason for no tax: companies under one still deduct a non-GAAP tax provision (HNGE, NET, DDOG).
function taxEvidence({ disclosed, releaseAccession } = {}) {
  return disclosed ? { basis: 'disclosed', rate: disclosed.rate, sentence: disclosed.sentence, accession: releaseAccession || null } : { basis: 'default' };
}

module.exports = { adjustedComponents, amortizationBreakdown, fullValuationAllowance, disclosedNonGaapTaxRate, taxEvidence, PRETAX, SBC, AMORTIZATION, ONE_TIME };
