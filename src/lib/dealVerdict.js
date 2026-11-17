import { calcProFormaEPS, epsAccretionPct, acquirerStandaloneEPS, acquirerReportedEPS, acquirerDilutedShares, forwardYearInputs, targetMarketPrice, TAX_RATE, privateConsideration } from '../utils/dealCalc';
import { accretionVerdict } from '../components/deck/shared/deckTokens';
import { NON_GAAP, computedSides } from './reportingBasis';
import { selectForwardYears, slotName, CONSENSUS_BASIS, synergyForSlot } from './forwardYears';

// The deal verdict ladder. Deal Summary and Executive Summary both render this one result. It uses the first test
// that this deal's own data can compute, and names the missing input when none can:
//   1. EPS accretion / (dilution) in Year 1, when the acquirer's standalone EPS is positive.
//   2. Otherwise the first forecast year where the acquirer's consensus EPS is positive (slide 9's own forward row, chosen
//      by src/lib/forwardYears.js: no year overlapping Year 1, and none at all on a GAAP deal — consensus is non-GAAP).
//   3. Otherwise run-rate (Year 3) synergies capitalized at the acquirer's P/E, or EV/EBITDA when the P/E is not
//      meaningful, against the premium paid in dollars. The synergy basis matches the multiple: EV/EBITDA is a
//      pre-tax multiple, so it capitalizes Year 3 synergies as entered (pre-tax); P/E is after tax, so it
//      capitalizes them after tax.
// Every EPS figure comes from dealCalc's own functions on slide 8's inputs. Nothing is estimated or defaulted.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };

export const TAG_YEAR1 = 'EPS test, Year 1';
export const TAG_PREMIUM = 'Premium vs synergies';
// The tag names the synergy basis and the multiple, e.g. "Premium vs synergies (pre-tax, EV/EBITDA 8.41x)".
export const tagPremium = (basis, multiple) => `${TAG_PREMIUM} (${basis}, ${multiple.name} ${multiple.value.toFixed(2)}x)`;
export const tagForwardYear = (label) => `EPS test, ${label} (first profitable year)`;

// $M, the deck's convention: $636M, $1.2B; negatives in parentheses.
export function fmtVerdictMoney(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}B` : `$${a.toFixed(0)}M`;
  return v < 0 ? `(${s})` : s;
}

// Pre-tax synergies (EBITDA impact) at which pro forma EPS equals standalone EPS. Two calls of the deal's own EPS
// function give the line (EPS is linear in synergies), so the breakeven is never a second copy of the model.
function epsBreakeven(offer, base, inputs) {
  const at0 = calcProFormaEPS(offer, 0, inputs);
  const at1 = calcProFormaEPS(offer, 1, inputs);
  if (at0 == null || at1 == null || !(at1 - at0 > 0)) return null;
  return (base - at0) / (at1 - at0);
}

function breakevenLine(breakeven, entered) {
  const enteredText = entered == null ? 'none entered' : `entered ${fmtVerdictMoney(entered)}`;
  if (breakeven == null) return null;
  // Fix 14 Task 4: a breakeven at or below zero means the deal is accretive before any synergy; a negative "breakeven
  // synergy" amount is not a figure anyone can act on, so it is not printed.
  if (breakeven <= 0) return `Accretive before any synergies; ${enteredText}`;
  return `Breaks even at ${fmtVerdictMoney(breakeven)} of synergies; ${enteredText}`;
}

// The EPS test on one year's inputs. Null when this year's EPS can't be computed.
function epsTest(offer, synergy, inputs) {
  const base = acquirerStandaloneEPS(inputs);
  if (!(base > 0)) return null;
  const pf = calcProFormaEPS(offer, synergy, inputs);
  if (pf == null) return null;
  const pct = epsAccretionPct(offer, synergy, inputs);   // null when pro forma EPS is not positive: that is dilutive
  const v = pct != null ? accretionVerdict(pct) : 'dilutive';
  return { verdict: v, pct, standaloneEPS: base, proFormaEPS: pf, breakeven: epsBreakeven(offer, base, inputs) };
}

// Fix 17 Task 6: the verdict's two year choices, exported so the input page's "Highest premium still accretive" box
// solves and names the same year the verdict uses. Year 1's EPS test (null when Year 1 doesn't compute) …
export function year1Test(offer, synergy, inputs) {
  const base = acquirerStandaloneEPS(inputs);
  if (!(base > 0)) return null;
  return epsTest(offer, synergy, inputs);
}
// … and, when it doesn't, the first forecast slot whose acquirer consensus EPS is positive (null when none).
export function verdictForwardSlot(sel) {
  return (sel?.slots || []).filter(s => s.epsOk).find(s => s.a.eps > 0) || null;
}

const VERDICT_TEXT = { accretive: 'Accretive', dilutive: 'Dilutive', neutral: 'Neutral' };
const fmtSigned = (p) => (p == null ? null : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`);
const fmtEps = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
// A percentage only when both EPS figures are positive. A pro forma EPS at or below zero is dilutive, shown in dollars.
const verdictText = (t) => `${VERDICT_TEXT[t.verdict]} (${t.pct != null ? fmtSigned(t.pct) : `pro forma EPS ${fmtEps(t.proFormaEPS)} vs ${fmtEps(t.standaloneEPS)}`})`;

// deal: the deck's deal object (deal._inputs, deal._results, deal.synergies). model: buildDeckModel's output.
// acquirerFwd / targetFwd: the forecast columns of /api/pnl (slide 8's source), or null while loading.
export function dealVerdict({ deal, model, acquirerFwd, targetFwd, fwdLoading, acquirerName, targetName }) {
  const A = acquirerName || 'the acquirer';
  const T = targetName || 'the target';
  const inputs = deal?._inputs || {};
  const results = deal?._results || {};
  // A Non-GAAP deal names the EPS basis in the tag (a GAAP deal's tags are unchanged).
  const ngDeal = inputs.reportingBasis === NON_GAAP;
  // Fix 13: a Year 1 EPS computed by EasyM&A (not company reported) is named in the tag; [] leaves the tag as it was.
  const ngComputed = ngDeal && deal?.reportingBasis ? computedSides(deal.reportingBasis).map((P) => deal.reportingBasis.tickers?.[P] || (P === 'A' ? A : T)) : [];
  const epsTag = (t) => (ngDeal ? `${t} (${inputs.companyAEpsBasis === NON_GAAP ? `non-GAAP EPS${ngComputed.length ? `; ${ngComputed.join(' and ')} computed by EasyM&A` : ''}` : 'GAAP EPS'})` : t);
  const offer = num(deal?.offerPrice) || num(inputs.offerPricePerShare) || 0;   // slide 8's own offer read
  const synY = [deal?.synergiesY1, deal?.synergiesY2, deal?.synergiesY3];
  const missing = [];

  // ── 1. Year 1 ──
  const y1Base = acquirerStandaloneEPS(inputs);
  if (y1Base > 0) {
    const t = year1Test(offer, deal?.synergiesY1 ?? results.synergiesY1, inputs);
    if (t) {
      const y1 = deal?.synergies?.years?.[0];
      return {
        step: 1, tag: epsTag(TAG_YEAR1), verdict: t.verdict,
        text: verdictText(t),
        pct: t.pct, standaloneEPS: t.standaloneEPS, proFormaEPS: t.proFormaEPS, breakeven: t.breakeven,
        entered: y1?.entered ? y1.ebitda : null, yearsUsed: ['Year 1'],
        line: withYears(breakevenLine(t.breakeven, y1?.entered ? y1.ebitda : null), 'Year 1'),
      };
    }
    missing.push(results.basesDiffer ? `Year 1 combines companies on different bases` : `Year 1 pro forma EPS can't be computed`);
  } else {
    missing.push(inputs.year1Reason ? `Year 1 —: ${inputs.year1Reason}` : `${A}'s standalone EPS is not positive`);
  }

  // ── 2. First forecast year with positive acquirer consensus EPS (slide 9's forward rows, the same selection) ──
  if (fwdLoading) return { step: null, verdict: null, text: '—', tag: null, line: 'Forward estimates are still loading.' };
  const sel = selectForwardYears({ inputs, acquirerFwd, targetFwd, acquirerName: A, targetName: T, privateTarget: privateConsideration(inputs) != null });
  const usable = sel.slots.filter(s => s.epsOk);
  const pick = verdictForwardSlot(sel);
  if (pick && acquirerDilutedShares(inputs).shares > 0) {
    const fwd = forwardYearInputs(inputs, pick.a.eps, pick.b.eps);
    const syn = parseFloat(synergyForSlot(synY, pick)) || 0;   // slide 9's forward row reads the same figure (synergyForSlot), with nothing entered — or a year past the schedule — as none
    const t = epsTest(offer, syn, fwd);
    if (t) {
      const yr = synergyForSlot(deal?.synergies?.years, pick);
      const yearLabel = pick.label;
      const skipped = [y1SkipReason(), ...sel.slots.filter(s => s !== pick && s.year < pick.year).map(s => `${slotName(s)} —: ${s.reason || `${A}'s consensus EPS is not positive`}`)].filter(Boolean);
      return {
        step: 2, tag: `${tagForwardYear(yearLabel)} · ${CONSENSUS_BASIS}`, verdict: t.verdict, year: yearLabel,
        text: verdictText(t),
        pct: t.pct, standaloneEPS: t.standaloneEPS, proFormaEPS: t.proFormaEPS, breakeven: t.breakeven,
        entered: yr?.entered ? yr.ebitda : null, yearsUsed: [slotName(pick)],
        // Fix 16 Task 3: the year's own inputs and synergy, so every table on the slide can use the verdict's year.
        inputs: fwd, synergy: syn, synergyEntered: !!yr?.entered,
        line: withYears(breakevenLine(t.breakeven, yr?.entered ? yr.ebitda : null), slotName(pick), skipped),
      };
    }
    missing.push(`pro forma EPS for ${slotName(pick)} can't be computed`);
  } else if (sel.gaap) {
    missing.push(`forward years —: ${sel.slots[0].reason}`);
  } else if (usable.length) {
    missing.push(`${A}'s consensus EPS is not positive in any forecast year`);
  } else {
    missing.push(...sel.slots.map(s => `${slotName(s)} —: ${s.reason}`));
  }

  // ── 3. Synergies vs premium ──
  const d = (model && model.derived) || {};
  const AV = (model && model.verifiedData && model.verifiedData.acquirer) || {};
  const ref = pos(targetMarketPrice(inputs));   // the one premium reference price
  const shares = pos(inputs.companyBShares);
  const premiumDollars = (pos(offer) != null && ref != null && shares != null) ? (offer - ref) * shares : null;
  const y3 = deal?.synergies?.years?.[2];
  const pe = (pos(AV.price) != null && y1Base > 0) ? AV.price / y1Base : null;
  // The acquirer's EBITDA on the deal's basis: on a Non-GAAP deal, its company-reported adjusted EBITDA where it reports
  // one (inputs.companyAEBITDA, set by src/lib/reportingBasis.js); otherwise the computed figure, as before.
  const acqEbitda = ngDeal ? inputs.companyAEBITDA : AV.ebitda;
  const evName = ngDeal && inputs.companyAEbitdaBasis === NON_GAAP ? 'EV/adjusted EBITDA (non-GAAP)' : 'EV/EBITDA';
  const evEbitda = (num(d.evAcquirer) != null && pos(acqEbitda) != null) ? d.evAcquirer / acqEbitda : null;
  const multiple = pe != null ? { value: pe, name: ngDeal ? `P/E (${inputs.companyAEpsBasis === NON_GAAP ? 'non-GAAP' : 'GAAP'} EPS)` : 'P/E' } : (evEbitda != null && evEbitda > 0 ? { value: evEbitda, name: evName } : null);
  if (premiumDollars == null) missing.push(ref == null ? `there is no market price for ${T}, so the premium can't be measured` : `${T}'s share count is missing, so the premium can't be measured`);
  if (!y3?.entered) missing.push('no Year 3 synergies are entered');
  if (multiple == null) missing.push(`${A}'s P/E and EV/EBITDA are not meaningful`);
  if (premiumDollars != null && y3?.entered && multiple != null) {
    // One factor carries the basis: 1 for EV/EBITDA (pre-tax), 1 − tax for P/E (after tax). The breakeven solves
    // the same product for the Year 3 synergies as entered (pre-tax), so it is on the same basis by construction.
    const basis = multiple.name.startsWith('EV/') ? 'pre-tax' : 'after-tax';
    const taxFactor = basis === 'pre-tax' ? 1 : 1 - TAX_RATE;
    const capitalizedSynergies = y3.ebitda * taxFactor;
    const value = capitalizedSynergies * multiple.value;
    const covers = value >= premiumDollars;
    const breakeven = premiumDollars / (multiple.value * taxFactor);
    return {
      step: 3, tag: tagPremium(basis, multiple), verdict: covers ? 'covers' : 'short',
      text: covers ? 'Synergies cover the premium' : "Synergies don't cover the premium",
      premiumDollars, multiple, synergyBasis: basis, capitalizedSynergies, capitalizedValue: value, breakeven, entered: y3.ebitda,
      line: breakevenLine(breakeven, y3.ebitda),
    };
  }
  return { step: null, verdict: null, text: '—', tag: null, line: `No test can be computed: ${missing.join('; ')}.`, missing };

  function y1SkipReason() { return y1Base > 0 ? null : `Year 1 —: ${inputs.year1Reason || `${A}'s standalone EPS is not positive`}`; }
}

// ── One EPS story (Fix 14 Task 3) ──
// Every headline EPS-impact figure (the Deal Summary tile and EPS Analysis, Executive Summary, the Exchange Ratio slide)
// reads this, so none can disagree with the verdict: the verdict's own year when it is a forecast year (Year 1 is "—"),
// else Year 1. Each result carries its year and basis in `label`. pct is null when not meaningful (an EPS ≤ 0), with why.
export function headlineEps(verdict, deal) {
  const inputs = deal?._inputs || {};
  const results = deal?._results || {};
  if (verdict && verdict.step === 2 && verdict.standaloneEPS != null) {
    return {
      label: `${verdict.year} · ${CONSENSUS_BASIS}`, year: verdict.year, fromVerdict: true,
      standaloneEPS: verdict.standaloneEPS, proFormaEPS: verdict.proFormaEPS, pct: verdict.pct, verdict: verdict.verdict,
      reason: verdict.pct == null ? 'not meaningful: pro forma EPS is not positive' : null,
    };
  }
  const per = inputs.companyABasis === 'ltm' ? 'LTM' : (inputs.companyAPeriodLabel || 'fiscal year');
  const basis = inputs.reportingBasis === NON_GAAP ? 'non-GAAP' : 'GAAP';   // a Non-GAAP deck's Year 1 is company-reported non-GAAP, or "—"
  const sa = num(results.companyAEPS), pf = num(results.proFormaEPS), pct = results.accretionMeaningful ? num(results.epsChangePct) : null;
  const reason = results.basesDiffer ? 'companies on different bases'
    : (sa == null || pf == null) ? (inputs.year1Reason || 'Year 1 EPS not available')
    : pct == null ? 'not meaningful: acquirer or pro forma EPS is not positive' : null;
  return {
    label: `Year 1 · ${per}, ${basis}`, year: 'Year 1', fromVerdict: !!(verdict && verdict.step === 1),
    standaloneEPS: results.basesDiffer ? null : sa, proFormaEPS: results.basesDiffer ? null : pf, pct: results.basesDiffer ? null : pct,
    verdict: pct == null ? null : accretionVerdict(pct), reason,
  };
}

// Fix 17 Task 1: the company-reported EPS shown as a labeled reference beside "Before" (Year 1 only; a forecast year's
// standalone EPS is the consensus figure itself). "Before" is net income ÷ the pro forma's share count; this line is the
// figure the company published, e.g. "Reported: $2.24 (sum of four quarterly releases)". null when the company reported
// none (a computed non-GAAP EPS is not reported) or when the headline is not Year 1.
export function reportedEpsReference(h, deal) {
  if (!h || h.year !== 'Year 1' || h.standaloneEPS == null) return null;
  const inputs = deal?._inputs || {};
  const v = acquirerReportedEPS(inputs);
  if (v == null) return null;
  let src;
  if (inputs.reportingBasis === NON_GAAP) {
    const plan = deal?.reportingBasis;
    const A = plan && plan.eps && plan.eps.nonGaap ? plan.eps.A : null;
    if (!A || A.computed) return null;
    src = A.ltmReported ? 'sum of four quarterly releases'
      : `${A.fiscalYearEnd ? `FY${String(A.fiscalYearEnd).slice(0, 4)} ` : ''}earnings release`;
  } else {
    src = inputs.companyABasis === 'ltm'
      ? (inputs.companyAEpsLabel || 'diluted, filed')   // ltmEps's own label: "sum of 4 filed quarters: quarter to … $0.37 + 9 months to … $1.58"
      : `diluted, ${inputs.companyAPeriodLabel || 'fiscal year'} 10-K`;
  }
  return { value: v, src, text: `Reported: ${fmtEps(v)} (${src})` };
}

// Fix 19 Task 5: the EPS the deal itself uses, in words — the acquirer's net income on the deal's basis ÷ the one diluted
// share count (acquirerDilutedShares, the count the pro forma divides by) = acquirerStandaloneEPS, with the
// company-reported figure named as a reference (reportedEpsReference). null when any figure is missing.
export function dealEpsMethodText(deal, ticker) {
  const inputs = deal?._inputs || {};
  const ni = num(inputs.companyANetIncome);
  const sh = acquirerDilutedShares(inputs).shares;
  const eps = acquirerStandaloneEPS(inputs);
  if (ni == null || !(sh > 0) || eps == null || !Number.isFinite(eps)) return null;
  const basis = inputs.reportingBasis === NON_GAAP ? 'non-GAAP' : 'GAAP';
  const ref = reportedEpsReference({ year: 'Year 1', standaloneEPS: eps }, deal);
  return `the deal uses ${ticker || 'the acquirer'} ${basis} net income ÷ ${sh.toFixed(1)}M diluted shares (${fmtEps(eps)})${ref ? `, with ${fmtEps(ref.value)} shown as the company-reported reference (${ref.src})` : ''}`;
}

// The breakeven line plus which years the verdict and breakeven used, and why any earlier year did not compute.
function withYears(line, used, skipped = []) {
  const u = `Verdict and breakeven use ${used}${skipped.length ? `; ${skipped.join('; ')}` : ''}.`;
  return line ? `${line}. ${u}` : u;
}

// Risk flags that follow from the verdict (Fix 10 Task 6). "No major flags — deal looks structurally sound" may show only
// when this list and the structural flags are both empty: a dilutive verdict, synergies short of the premium, a
// breakeven above the synergies entered, or a verdict that can't be computed are flags themselves, with their numbers.
export function verdictFlags(v) {
  const out = [];
  if (!v || v.text === '—' && v.line === 'Forward estimates are still loading.') return out;
  if (v.step == null) {
    out.push({ level: 'warning', icon: '⚠️', text: `No deal verdict: ${String(v.line || 'no test can be computed').replace(/^No test can be computed: /, 'no test can be computed — ')}` });
    return out;
  }
  if (v.verdict === 'dilutive') out.push({ level: 'critical', icon: '🚨', text: `Dilutive: ${v.text}, ${v.tag}` });
  if (v.verdict === 'short') out.push({ level: 'critical', icon: '🚨', text: `${v.text}: premium ${fmtVerdictMoney(v.premiumDollars)} vs capitalized Year 3 synergies ${fmtVerdictMoney(v.capitalizedValue)} (${v.tag})` });
  // Synergies entered: none entered is the deal's own state (nothing assumed), so any positive breakeven exceeds it.
  if (v.breakeven != null && v.breakeven > 0 && v.breakeven > (v.entered ?? 0)) {
    out.push({ level: 'warning', icon: '⚠️', text: `Synergy gap: breaks even at ${fmtVerdictMoney(v.breakeven)} of synergies; ${v.entered == null ? 'none entered' : `entered ${fmtVerdictMoney(v.entered)}`}` });
  }
  return out;
}
