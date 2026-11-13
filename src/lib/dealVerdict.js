import { calcProFormaEPS, epsAccretionPct, acquirerStandaloneEPS, acquirerDilutedShares, forwardYearInputs, targetMarketPrice, TAX_RATE, privateConsideration } from '../utils/dealCalc';
import { accretionVerdict } from '../components/deck/shared/deckTokens';
import { NON_GAAP } from './reportingBasis';
import { selectForwardYears, slotName, CONSENSUS_BASIS } from './forwardYears';

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
  if (breakeven <= 0) return `Breaks even with no synergies (at ${fmtVerdictMoney(breakeven)}); ${enteredText}`;
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
  const epsTag = (t) => (ngDeal ? `${t} (${inputs.companyAEpsBasis === NON_GAAP ? 'non-GAAP EPS' : 'GAAP EPS'})` : t);
  const offer = num(deal?.offerPrice) || num(inputs.offerPricePerShare) || 0;   // slide 8's own offer read
  const synY = [deal?.synergiesY1, deal?.synergiesY2, deal?.synergiesY3];
  const missing = [];

  // ── 1. Year 1 ──
  const y1Base = acquirerStandaloneEPS(inputs);
  if (y1Base > 0) {
    const t = epsTest(offer, deal?.synergiesY1 ?? results.synergiesY1, inputs);
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
  const pick = usable.find(s => s.a.eps > 0);
  if (pick && acquirerDilutedShares(inputs).shares > 0) {
    const fwd = forwardYearInputs(inputs, pick.a.eps, pick.b.eps);
    const syn = parseFloat(synY[pick.synYr - 1]) || 0;   // slide 9's forward row reads the same figure, with nothing entered as none
    const t = epsTest(offer, syn, fwd);
    if (t) {
      const yr = deal?.synergies?.years?.[pick.synYr - 1];
      const yearLabel = pick.label;
      const skipped = [y1SkipReason(), ...sel.slots.filter(s => s !== pick && s.year < pick.year).map(s => `${slotName(s)} —: ${s.reason || `${A}'s consensus EPS is not positive`}`)].filter(Boolean);
      return {
        step: 2, tag: `${tagForwardYear(yearLabel)} · ${CONSENSUS_BASIS}`, verdict: t.verdict, year: yearLabel,
        text: verdictText(t),
        pct: t.pct, standaloneEPS: t.standaloneEPS, proFormaEPS: t.proFormaEPS, breakeven: t.breakeven,
        entered: yr?.entered ? yr.ebitda : null, yearsUsed: [slotName(pick)],
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

// The breakeven line plus which years the verdict and breakeven used, and why any earlier year did not compute.
function withYears(line, used, skipped = []) {
  const u = `Verdict and breakeven use ${used}${skipped.length ? `; ${skipped.join('; ')}` : ''}.`;
  return line ? `${line}. ${u}` : u;
}
