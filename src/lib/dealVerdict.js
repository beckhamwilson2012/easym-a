import { calcProFormaEPS, epsAccretionPct, acquirerStandaloneEPS, acquirerDilutedShares, forwardYearInputs, targetMarketPrice, TAX_RATE } from '../utils/dealCalc';
import { accretionVerdict } from '../components/deck/shared/deckTokens';

// The deal verdict ladder. Deal Summary and Executive Summary both render this one result. It uses the first test
// that this deal's own data can compute, and names the missing input when none can:
//   1. EPS accretion / (dilution) in Year 1, when the acquirer's standalone EPS is positive.
//   2. Otherwise the first forecast year where the acquirer's consensus EPS is positive (slide 8's own forward row).
//   3. Otherwise run-rate (Year 3) after-tax synergies capitalized at the acquirer's P/E, or EV/EBITDA when the
//      P/E is not meaningful, against the premium paid in dollars.
// Every EPS figure comes from dealCalc's own functions on slide 8's inputs. Nothing is estimated or defaulted.

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const pos = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };

export const TAG_YEAR1 = 'EPS test, Year 1';
export const TAG_PREMIUM = 'Premium vs synergies';
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
        step: 1, tag: TAG_YEAR1, verdict: t.verdict,
        text: verdictText(t),
        pct: t.pct, standaloneEPS: t.standaloneEPS, proFormaEPS: t.proFormaEPS, breakeven: t.breakeven,
        entered: y1?.entered ? y1.ebitda : null,
        line: breakevenLine(t.breakeven, y1?.entered ? y1.ebitda : null),
      };
    }
    missing.push(results.basesDiffer ? `Year 1 combines companies on different bases` : `Year 1 pro forma EPS can't be computed`);
  } else {
    missing.push(`${A}'s standalone EPS is not positive`);
  }

  // ── 2. First forecast year with positive acquirer consensus EPS (slide 8's forward rows, same pairing) ──
  if (fwdLoading) return { step: null, verdict: null, text: '—', tag: null, line: 'Forward estimates are still loading.' };
  const aF = acquirerFwd || [], bF = targetFwd || [];
  const n = Math.min(aF.length, bF.length);
  const k = aF.slice(0, n).findIndex(c => c && c.eps != null && c.eps > 0);
  if (k >= 0 && bF[k]?.eps != null && acquirerDilutedShares(inputs).shares > 0) {
    const fwd = forwardYearInputs(inputs, aF[k].eps, bF[k].eps);
    const syn = parseFloat(synY[k]) || 0;   // slide 8's forward row reads the same figure, with nothing entered as none
    const t = epsTest(offer, syn, fwd);
    if (t) {
      const yr = deal?.synergies?.years?.[k];
      const yearLabel = label(aF[k]);
      return {
        step: 2, tag: tagForwardYear(yearLabel), verdict: t.verdict, year: yearLabel,
        text: verdictText(t),
        pct: t.pct, standaloneEPS: t.standaloneEPS, proFormaEPS: t.proFormaEPS, breakeven: t.breakeven,
        entered: yr?.entered ? yr.ebitda : null,
        line: breakevenLine(t.breakeven, yr?.entered ? yr.ebitda : null),
      };
    }
    missing.push(`pro forma EPS for ${label(aF[k])} can't be computed`);
  } else if (k >= 0) {
    missing.push(`${T} has no consensus EPS for ${label(aF[k])}`);
  } else {
    missing.push(n === 0 ? `no forecast EPS for ${A}` : `${A}'s consensus EPS is not positive in any forecast year`);
  }

  // ── 3. Synergies vs premium ──
  const d = (model && model.derived) || {};
  const AV = (model && model.verifiedData && model.verifiedData.acquirer) || {};
  const ref = pos(targetMarketPrice(inputs));   // the one premium reference price
  const shares = pos(inputs.companyBShares);
  const premiumDollars = (pos(offer) != null && ref != null && shares != null) ? (offer - ref) * shares : null;
  const y3 = deal?.synergies?.years?.[2];
  const pe = (pos(AV.price) != null && y1Base > 0) ? AV.price / y1Base : null;
  const evEbitda = (num(d.evAcquirer) != null && pos(AV.ebitda) != null) ? d.evAcquirer / AV.ebitda : null;
  const multiple = pe != null ? { value: pe, name: 'P/E' } : (evEbitda != null && evEbitda > 0 ? { value: evEbitda, name: 'EV/EBITDA' } : null);
  if (premiumDollars == null) missing.push(ref == null ? `there is no market price for ${T}, so the premium can't be measured` : `${T}'s share count is missing, so the premium can't be measured`);
  if (!y3?.entered) missing.push('no Year 3 synergies are entered');
  if (multiple == null) missing.push(`${A}'s P/E and EV/EBITDA are not meaningful`);
  if (premiumDollars != null && y3?.entered && multiple != null) {
    const afterTax = y3.ebitda * (1 - TAX_RATE);
    const value = afterTax * multiple.value;
    const covers = value >= premiumDollars;
    const breakeven = premiumDollars / (multiple.value * (1 - TAX_RATE));
    return {
      step: 3, tag: TAG_PREMIUM, verdict: covers ? 'covers' : 'short',
      text: covers ? 'Synergies cover the premium' : "Synergies don't cover the premium",
      premiumDollars, multiple, afterTaxSynergies: afterTax, capitalizedValue: value, breakeven, entered: y3.ebitda,
      line: breakevenLine(breakeven, y3.ebitda),
    };
  }
  return { step: null, verdict: null, text: '—', tag: null, line: `No test can be computed: ${missing.join('; ')}.`, missing };

  function label(c) { return c?.label || (c?.fy != null ? `FY${c.fy}E` : 'that year'); }
}
