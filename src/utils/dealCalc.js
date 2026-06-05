// ── Sensitivity table constants ───────────────────────────────────────────────
export const PRICE_MULTS  = [0.8, 0.9, 1.0, 1.1, 1.2];
export const PRICE_LABELS = ['-20%', '-10%', 'Current', '+10%', '+20%'];
export const SYN_MULTS    = [0.5, 0.75, 1.0, 1.25, 1.5];
export const SYN_LABELS   = ['50%', '75%', '100%', '125%', '150%'];

// ── Transaction assumptions (documented; not fetched data) ────────────────────
// TAX_RATE applies to synergies (taxed) and, if used, to financing interest (tax-shielded).
export const TAX_RATE           = 0.21;  // US federal statutory rate
// Incremental financing cost on the cash portion. The BASE accretion/dilution check assumes NO
// incremental financing-cost drag (the standard quick convention) → default 0, so pro-forma EPS =
// (A.NI + B.NI + after-tax synergies) ÷ combined shares. Raise this to model fully debt-funded cash.
export const DEBT_INTEREST_RATE = 0;

// Acquirer market price for share issuance: prefer the REAL live price; only fall back to a
// P/E proxy (EPS×15) when no live price is available, and never produce a price from a loss.
export function acquirerSharePrice(inputs) {
  const live = parseFloat(inputs.currentSharePriceA) || 0;
  if (live > 0) return live;
  const eps = parseFloat(inputs.companyAEPS) || 0;
  return eps > 0 ? eps * 15 : 0;
}

// Acquirer standalone EPS for the accretion/dilution comparison. Computed as net income ÷ shares
// outstanding so it is on the SAME basis as the pro-forma EPS (also net income ÷ shares) — an
// apples-to-apples comparison. This can differ slightly from the reported (diluted) EPS shown on the
// Standalone P&L slide because reported EPS uses diluted weighted-average shares. Falls back to the
// reported EPS only when shares are missing.
export function acquirerStandaloneEPS(inputs) {
  const shares = parseFloat(inputs.companyAShares)    || 0;
  const ni     = parseFloat(inputs.companyANetIncome) || 0;
  if (shares > 0) return ni / shares;
  return parseFloat(inputs.companyAEPS) || 0;
}

// Target market price for the PREMIUM. Use ONLY the real live price — a premium measured against an
// EPS×15 proxy is meaningless (it produced the nonsensical "−34.5% premium" when the live price was
// missing). Returns 0 when there is no live price, so the premium is reported as N/A rather than a
// fabricated discount.
export function targetMarketPrice(inputs) {
  return parseFloat(inputs.currentSharePriceB) || 0;
}

// ── Core calculation ──────────────────────────────────────────────────────────

export function calculate(inputs) {
  const {
    companyAShares, companyADebt,
    companyBShares, companyBEPS, companyBCash, companyBDebt,
    companyARevenue, companyAEBITDA, companyANetIncome,
    companyBRevenue, companyBEBITDA, companyBNetIncome,
    offerPricePerShare, cashPercent, transactionFees,
    synergiesY1, synergiesY2, synergiesY3,
  } = inputs;

  const stockPercent       = 100 - cashPercent;
  const totalPurchasePrice = offerPricePerShare * companyBShares;
  const cashPortion        = totalPurchasePrice * (cashPercent / 100);
  const stockPortion       = totalPurchasePrice * (stockPercent / 100);

  // New shares issued = stock consideration ÷ REAL acquirer price (non-zero whenever there is a
  // stock portion and we have a price). This is the bug that previously produced "0M new shares".
  const acqPrice         = acquirerSharePrice(inputs);
  const newSharesIssued  = acqPrice > 0 ? stockPortion / acqPrice : 0;
  const totalShares      = companyAShares + newSharesIssued;

  const combinedRevenue  = companyARevenue + companyBRevenue;
  const combinedEBITDA   = companyAEBITDA + companyBEBITDA + synergiesY1; // synergies pre-tax

  // Pro-forma RECURRING net income: combine both companies, add after-tax synergies, subtract the
  // after-tax interest cost of debt-funding the cash portion. One-time transaction fees do NOT
  // belong in recurring earnings, so they are excluded from EPS (shown separately as a deal cost).
  const afterTaxSynergies   = synergiesY1 * (1 - TAX_RATE);
  const newInterestAfterTax = cashPortion * DEBT_INTEREST_RATE * (1 - TAX_RATE);
  const proFormaNetIncome   = companyANetIncome + companyBNetIncome
                              + afterTaxSynergies - newInterestAfterTax;
  const proFormaEPS         = totalShares > 0 ? proFormaNetIncome / totalShares : 0;

  // Accretion / dilution. A percent change is only meaningful when BOTH the standalone and the
  // pro-forma EPS are positive — a move off a non-positive base (e.g. -$0.98 → $0.00) is neither a
  // clean "accretive" nor a real "-100%". In any degenerate case we lean dilutive and show the
  // absolute EPS values with no percentage.
  const standaloneEPS       = acquirerStandaloneEPS(inputs); // net income ÷ shares (same basis as PF)
  const accretionMeaningful = standaloneEPS > 0 && proFormaEPS > 0;
  const isAccretive         = accretionMeaningful && proFormaEPS > standaloneEPS;
  const epsChangePct        = accretionMeaningful
    ? ((proFormaEPS - standaloneEPS) / standaloneEPS) * 100 : null;

  // Premium against the REAL current target price (not an EPS×15 proxy).
  const tgtPrice         = targetMarketPrice(inputs);
  const purchasePremium  = tgtPrice > 0 ? ((offerPricePerShare - tgtPrice) / tgtPrice) * 100 : null;

  // Multiples / leverage — guard non-positive denominators (negative EBITDA/EPS → N/A, not nonsense).
  const enterpriseValue  = totalPurchasePrice + companyBDebt - companyBCash;
  const evEBITDA         = companyBEBITDA > 0 ? enterpriseValue / companyBEBITDA : null;
  const peRatio          = companyBEPS    > 0 ? offerPricePerShare / companyBEPS : null;
  const combinedDebt     = companyADebt + companyBDebt + cashPortion;
  const debtEBITDA       = combinedEBITDA > 0 ? combinedDebt / combinedEBITDA : null;

  return {
    isAccretive,
    accretionMeaningful,
    epsChangePct:      epsChangePct === null ? null : epsChangePct.toFixed(1),
    proFormaEPS:       proFormaEPS.toFixed(2),
    proFormaNetIncome: proFormaNetIncome.toFixed(0),
    afterTaxSynergies: afterTaxSynergies.toFixed(0),
    newInterestAfterTax: newInterestAfterTax.toFixed(0),
    acquirerSharePrice: acqPrice.toFixed(2),
    evEBITDA:          evEBITDA   === null ? 'N/A' : evEBITDA.toFixed(1),
    peRatio:           peRatio    === null ? 'N/A' : peRatio.toFixed(1),
    debtEBITDA:        debtEBITDA === null ? 'N/A' : debtEBITDA.toFixed(1),
    totalPurchasePrice: totalPurchasePrice.toFixed(0),
    cashPortion:        cashPortion.toFixed(0),
    stockPortion:       stockPortion.toFixed(0),
    newSharesIssued:    newSharesIssued.toFixed(0),
    purchasePremium:    purchasePremium === null ? null : purchasePremium.toFixed(1),
    combinedRevenue:    combinedRevenue.toFixed(0),
    combinedEBITDA:     combinedEBITDA.toFixed(0),
    // combinedNetIncome reflects the pro-forma recurring net income used for EPS (consistent).
    combinedNetIncome:  proFormaNetIncome.toFixed(0),
    synergiesY1, synergiesY2, synergiesY3,
    transactionFees,
    // Standalone EPS on the net-income÷shares basis used for the accretion comparison (so the
    // dashboard "Before → After" and the percent change are internally consistent).
    companyAEPS:        standaloneEPS.toFixed(2),
  };
}

// ── Sensitivity helper ────────────────────────────────────────────────────────
// Must mirror calculate()'s pro-forma EPS exactly so the sensitivity grid is consistent.

export function calcProFormaEPS(offerPrice, synergiesY1, inputs) {
  const { companyAShares, companyANetIncome, companyBShares,
          companyBNetIncome, cashPercent } = inputs;
  const acqPrice = acquirerSharePrice(inputs);
  if (acqPrice === 0 || companyBShares === 0) return null;
  const stockPercent = 100 - cashPercent;
  const totalPP      = offerPrice * companyBShares;
  const cashPortion  = totalPP * (cashPercent / 100);
  const stockPortion = totalPP * (stockPercent / 100);
  const newShares    = stockPortion / acqPrice;
  const totalShares  = companyAShares + newShares;
  if (totalShares === 0) return null;
  const afterTaxSynergies   = synergiesY1 * (1 - TAX_RATE);
  const newInterestAfterTax = cashPortion * DEBT_INTEREST_RATE * (1 - TAX_RATE);
  const netIncome = companyANetIncome + companyBNetIncome + afterTaxSynergies - newInterestAfterTax;
  return netIncome / totalShares;
}

// ── Risk flags ────────────────────────────────────────────────────────────────

export function computeFlags(results, inputs) {
  const flags = [];
  if (parseFloat(results.totalPurchasePrice) > 500000)
    flags.push({ level: 'critical', icon: '🚨', text: 'Deal size exceeds $500B — likely to face significant antitrust scrutiny' });
  if (results.debtEBITDA !== 'N/A' && parseFloat(results.debtEBITDA) > 5)
    flags.push({ level: 'critical', icon: '🚨', text: 'Combined leverage is very high — debt burden may be unsustainable' });
  if (inputs.companyAShares > 0 && parseFloat(results.newSharesIssued) / inputs.companyAShares > 0.2)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Significant share dilution — existing shareholders may be negatively impacted' });
  if (parseFloat(results.purchasePremium) > 50)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Very high acquisition premium — overpaying risk is elevated' });
  return flags;
}

// ── Deal score ────────────────────────────────────────────────────────────────

export function computeDealScore(results, flags) {
  let score = 5;
  const epsChangePct   = parseFloat(results.epsChangePct);
  const debtEBITDA     = results.debtEBITDA !== 'N/A' ? parseFloat(results.debtEBITDA) : null;
  const purchasePremium = parseFloat(results.purchasePremium);

  if (results.isAccretive) score += 2; else score -= 2;
  if (epsChangePct > 10) score += 1;
  if (epsChangePct < 0) score -= 1;
  if (debtEBITDA !== null && debtEBITDA < 3) score += 1;
  if (debtEBITDA !== null && debtEBITDA > 5) score -= 1;
  if (purchasePremium < 30) score += 1;
  if (purchasePremium > 50) score -= 1;
  if (parseFloat(results.totalPurchasePrice) > 500000) score -= 2;

  return Math.max(1, Math.min(10, score));
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatDollars(m) {
  const v = parseFloat(m);
  if (isNaN(v)) return 'N/A';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

// ── Narrative ─────────────────────────────────────────────────────────────────

export function buildNarrative(results, inputs, nameA, nameB, flags) {
  const a   = nameA || 'Company A';
  const b   = nameB || 'Company B';
  const priceStr = `$${(parseFloat(inputs.offerPricePerShare) || 0).toFixed(2)}`;
  const totalStr = formatDollars(results.totalPurchasePrice);
  const direction = results.isAccretive ? 'accretive' : 'dilutive';

  // When the acquirer is loss-making (standalone EPS ≤ 0) a percentage change from a negative base
  // is not meaningful — describe the absolute EPS move instead of reporting a misleading percentage.
  const pct = results.epsChangePct === null ? null : parseFloat(results.epsChangePct);
  let text;
  if (pct === null || isNaN(pct)) {
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) would be ${direction}, moving pro forma EPS from $${results.companyAEPS} to $${results.proFormaEPS} (percentage change not meaningful from a negative base).`;
  } else {
    const epsDir = results.isAccretive ? 'increasing' : 'decreasing';
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) would be ${direction}, ${epsDir} EPS by ${Math.abs(pct).toFixed(1)}% from $${results.companyAEPS} to $${results.proFormaEPS}.`;
  }
  if (flags.length > 0) {
    text += ` ${flags[0].text.split('—')[0].trim()} represents the deal's biggest structural risk.`;
  }
  if (inputs.synergiesY1 > 0) {
    text += ` Year 1 synergies of ${formatDollars(inputs.synergiesY1)} help offset ${formatDollars(inputs.transactionFees)} in transaction costs.`;
  }
  return text;
}
