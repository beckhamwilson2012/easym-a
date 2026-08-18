// ─────────────────────────────────────────────────────────────────────────────
// C1 — Single source of truth for every deal-level "shared number" the deck renders.
//
// Per the MASTER_DECK_SPEC handoff (hard rule #4): all slides must read shared numbers
// (market cap, offer price, current price, ownership %, share counts, accretion) from ONE
// computed object rather than re-deriving them locally. Independent re-derivation is the root
// cause of the master deck's cross-slide contradictions (two market caps, two offers, two
// ownership splits, etc.). The discovery pass found these numbers computed in 13–33 places each.
//
// This module is a pure ASSEMBLER: it reads values already computed upstream — the calc-engine
// results carried on `deal._results`/`deal.*`, and the live equity values produced by the App.js
// deck builders (`acquirer.currentMarketCap`, `deal.newSharesIssued`, …) — and centralizes them,
// computing only the handful of fields that sections previously re-derived (ownership %, pro-forma
// share count, trading EV, pro-forma equity value, exchange ratio). It introduces NO new data
// source and mutates nothing, so wiring a section to it leaves every currently-displayed value
// byte-identical. The fields it adds (e.g. exchangeRatio) are not yet rendered anywhere; they exist
// so the deferred spec-conformance slides (e.g. the master's Exchange Ratio slide) read one value.
// ─────────────────────────────────────────────────────────────────────────────

import { enterpriseValue, netCashDebt } from './netDebt';

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

export function buildDeckModel({ target = {}, acquirer = {}, deal = {} } = {}) {
  const results = deal._results || null;

  // ── Documented assumptions (not fetched data) ──────────────────────────────
  const offerPrice  = num(deal.offerPrice);
  const cashPercent = num(deal.cashPercent);
  const dealAssumptions = {
    offerPrice,
    cashPercent,
    stockPercent:  cashPercent != null ? 100 - cashPercent : null,
    premiumPct:    num(deal.purchasePremium),   // dealCalc.purchasePremium — single source
    financingRate: 0.05,                        // mirrors dealCalc.DEBT_INTEREST_RATE
    taxRate:       0.21,                         // mirrors dealCalc.TAX_RATE
    synergiesY1:   num(deal.synergiesY1),
    synergiesY2:   num(deal.synergiesY2),
    synergiesY3:   num(deal.synergiesY3),
    transactionFees: num(deal.transactionFees ?? deal.lehmanFee),
  };

  // ── Verified per-company snapshot (live equity value + fundamentals) ────────
  const perCompany = (c) => ({
    ticker: c.ticker || null,
    name:   c.name || null,
    shares: num(c.shares),
    price:  num(c.sharePrice),
    // currentMarketCap = LIVE price × shares (real equity value). This — NOT the overloaded
    // `marketCap` (which for the TARGET equals the acquisition price ≈ totalPurchasePrice) — is the
    // canonical "Market Cap" used by §6/§9. Keeping a single definition removes the latent
    // confusion where one slide could show acquisition price and another the trading cap.
    marketCap: num(c.currentMarketCap),
    debt:    num(c.debt),
    cash:    num(c.cash),
    sti:     num(c.sti),   // short-term marketable securities — net-debt convention (b)
    revenue: num(c.revenue),
    ebitda:  num(c.ebitda),
    netIncome: num(c.netIncome),
  });
  const A = perCompany(acquirer);
  const T = perCompany(target);

  // ── Capitalization split (ONE definition; §9 and §10 each computed this independently) ──
  // newShares: recompute at full precision (stock consideration ÷ acquirer price) rather than trust
  // deal.newSharesIssued, which dealCalc rounds to whole millions. For a small target (RRGB: 40% stock,
  // ~$70M ÷ ~$273 ≈ 0.26M shares) the rounded value is "0", which then zeroes ownershipNewPct below and
  // makes §8/§11 read "0 shares / 0% ownership" for a real sub-1% stake. Recomputing keeps the share
  // count and ownership split honest at sub-1% precision. Falls back to the rounded value (or 0) when the
  // inputs needed to recompute are unavailable. No calc changed — same offer/mix/price, simply un-rounded.
  const _stockConsideration = (num(deal.totalPrice) != null && dealAssumptions.stockPercent != null)
    ? num(deal.totalPrice) * (dealAssumptions.stockPercent / 100) : null;
  const _newSharesPrecise = (_stockConsideration != null && A.price > 0)
    ? _stockConsideration / A.price : null;
  // No acquirer price → share issuance is not derivable. Keep newShares null (→ "—"); do NOT fall to 0,
  // which would render a fabricated "0 shares issued / 100% acquirer" split. Precise recompute and the
  // rounded-fallback both require A.price > 0; absent that, the whole issuance chain is unknown.
  const newShares      = _newSharesPrecise != null ? _newSharesPrecise : (A.price > 0 ? (num(deal.newSharesIssued) || 0) : null);
  const preDealShares  = A.shares;   // Stage 16: preserve null (was `|| 0`); a null acquirer share count is unknown, not 0.
  // proFormaShares is null when EITHER leg is unknown. MUST guard preDealShares too (Stage 16): with :79
  // null-honest but this sum unguarded, `null + newShares` = newShares — pre-deal ownership would read 0%
  // while pro-forma shares look plausible, a fabricated number that survives inspection (worse than the old
  // visible 0%). A pro-forma total omitting the (unknown) pre-deal or new shares implies zero dilution —
  // the fabrication we are removing. Render "—", not a coerced sum.
  const proFormaShares = (preDealShares != null && newShares != null) ? preDealShares + newShares : null;
  const ownershipExistingPctShares = proFormaShares > 0 ? (preDealShares / proFormaShares) * 100 : null;
  const ownershipNewPctShares      = proFormaShares > 0 ? (newShares     / proFormaShares) * 100 : null;

  // ── Phase 9 — equity-value ownership split (private deal: no share price → share-based split is null) ──
  // Each side's equity value = its live market cap when public, else the private valuation's equity value
  // (peer-median EV/EBITDA × EBITDA − net debt, computed in App.js from page-cited figures). Ownership is
  // adjusted for the CASH consideration: only the STOCK portion of the purchase issues new ownership; cash
  // paid does not dilute the acquirer's holders. tgtOwn = stockConsideration / (acquirerEquity + stock).
  const equityAcquirer = A.marketCap != null ? A.marketCap : num(acquirer.valuation?.equityValue);
  const equityTarget   = T.marketCap != null ? T.marketCap : num(target.valuation?.equityValue);
  const stockPctModel  = dealAssumptions.stockPercent;
  const stockConsiderationEq = (equityTarget != null && stockPctModel != null) ? equityTarget * (stockPctModel / 100) : null;
  const ownByValue = (equityAcquirer != null && stockConsiderationEq != null && (equityAcquirer + stockConsiderationEq) > 0)
    ? { newPct: (stockConsiderationEq / (equityAcquirer + stockConsiderationEq)) * 100,
        existingPct: (equityAcquirer / (equityAcquirer + stockConsiderationEq)) * 100 }
    : null;
  // Prefer the share-based split (public deals — unchanged, byte-identical); use the value-based split ONLY
  // when the share-based one is unavailable (private deal). Never fabricate: both null → null (renders "—").
  const ownershipExistingPct = ownershipExistingPctShares != null ? ownershipExistingPctShares : (ownByValue ? ownByValue.existingPct : null);
  const ownershipNewPct      = ownershipNewPctShares      != null ? ownershipNewPctShares      : (ownByValue ? ownByValue.newPct      : null);
  // Relative-valuation exchange ratio: target equity value per unit of acquirer equity value. For a private
  // deal with no per-share prices, this VALUE ratio is the meaningful "exchange ratio" (the per-share ratio
  // below needs prices, so it stays null). Null-honest when either equity value is absent.
  const valuationExchangeRatio = (equityTarget != null && equityAcquirer > 0) ? equityTarget / equityAcquirer : null;

  // ── Trading enterprise value (cap + debt − cash). Mirrors §2/§6 'trading EV' — distinct from
  //    the TRANSACTION EV (offer-based) used for deal multiples. Kept separate on purpose. ──
  // Requires both debt and cash (Fix A): a stale-rejected component (null) makes EV unavailable rather than
  // silently dropping it to 0. (Currently unrendered, but kept null-honest so it can never leak a partial EV.)
  const tradingEV = (cap, c) => enterpriseValue(cap, c.debt, c.cash, c.sti);   // shared helper — cash bucket = cash + short-term marketable securities

  // ── Transaction economics ──────────────────────────────────────────────────
  const totalConsideration = num(deal.totalPrice);
  // Pro-forma equity value ≈ acquirer live cap + total consideration (mirrors §9 bridge).
  const pfEquityValue = (A.marketCap != null && totalConsideration != null)
    ? A.marketCap + totalConsideration : null;
  // Transaction EV of the target (acquisition basis) — re-derived in 5 places today (dealCalc,
  // Dashboard, AVP explainer, explanations, orphan TargetOverview). Centralized here.
  const transactionEV = (totalConsideration != null && T.debt != null && T.cash != null)
    ? totalConsideration + netCashDebt(T.debt, T.cash, T.sti) : null;   // net debt via shared helper (cash + short-term marketable)
  // Exchange ratio = new acquirer shares issued per target share (master slide 8). Our deck has no
  // Exchange Ratio slide yet — computed here so the future slide reads ONE value.
  const stockPerTargetShare = (offerPrice != null && dealAssumptions.stockPercent != null)
    ? offerPrice * (dealAssumptions.stockPercent / 100) : null;
  const exchangeRatio = (stockPerTargetShare != null && A.price > 0)
    ? stockPerTargetShare / A.price : null;

  // ── Accretion (ONE result; dealCalc.epsAccretionPct is already the single source, shared by
  //    the §0 headline and the §7 accretion table). Basis is labeled; the NON-GAAP accretive
  //    layer the spec mandates is a separate, deferred phase (it changes displayed numbers). ──
  const accretion = {
    pct:           num(deal.epsAccretion),       // results.epsChangePct
    isAccretive:   !!deal.isAccretive,
    standaloneEPS: num(results?.companyAEPS),     // reported diluted EPS (NI ÷ diluted shares as fallback)
    proFormaEPS:   num(deal.proFormaEPS),
    basis: 'Reported diluted EPS (net income ÷ diluted shares as fallback)',
  };

  const derived = {
    // prices
    offerPrice,
    currentPriceTarget:   T.price,
    currentPriceAcquirer: A.price,
    premiumPct: dealAssumptions.premiumPct,
    // caps & enterprise value (live equity value — single definition)
    marketCapAcquirer: A.marketCap,
    marketCapTarget:   T.marketCap,
    evAcquirer: tradingEV(A.marketCap, A),
    evTarget:   tradingEV(T.marketCap, T),
    // capitalization
    newShares,
    preDealShares,
    targetShares: T.shares,
    proFormaShares,
    ownershipExistingPct,
    ownershipNewPct,
    exchangeRatio,
    // Phase 9 — equity-value split + relative valuation (private deals; null on public, which use the
    // share-based fields above). equityAcquirer/equityTarget: live cap when public, else private valuation.
    equityAcquirer,
    equityTarget,
    stockConsiderationEq,
    valuationExchangeRatio,
    ownershipBasis: ownershipNewPctShares != null ? 'shares' : (ownByValue ? 'equity-value' : null),
    // transaction
    totalConsideration,
    pfEquityValue,
    transactionEV,
    // accretion
    accretion,
    // combined
    combinedRevenue: num(deal.combinedRevenue),
    // one deck-wide market-data date (display handled by formatDeckDate at the section)
    dataDate: deal._dataDate || null,
  };

  return { dealAssumptions, verifiedData: { acquirer: A, target: T }, derived };
}

// Diagnostic: one-line dump of the derived shared numbers, for before/after proofs.
export function describeDeckModel(model) {
  const d = model.derived;
  const f = (v, dp = 1) => (v == null ? '—' : Number(v).toFixed(dp));
  const b = (v) => (v == null ? '—' : `$${(v / 1000).toFixed(1)}B`);
  return [
    `offer=$${f(d.offerPrice, 2)}`,
    `curTgt=$${f(d.currentPriceTarget, 2)}`,
    `prem=${f(d.premiumPct)}%`,
    `capA=${b(d.marketCapAcquirer)}`,
    `capT=${b(d.marketCapTarget)}`,
    `evA=${b(d.evAcquirer)}`,
    `newSh=${f(d.newShares)}M`,
    `preSh=${f(d.preDealShares)}M`,
    `pfSh=${f(d.proFormaShares)}M`,
    `own=${f(d.ownershipExistingPct)}/${f(d.ownershipNewPct)}%`,
    `xRatio=${f(d.exchangeRatio, 4)}`,
    `pfEq=${b(d.pfEquityValue)}`,
    `txEV=${b(d.transactionEV)}`,
    `acc=${d.accretion.pct == null ? 'n/m' : (d.accretion.pct >= 0 ? '+' : '') + f(d.accretion.pct) + '%'}(${d.accretion.isAccretive ? 'accretive' : 'dilutive'})`,
    `eps=${f(d.accretion.standaloneEPS, 2)}->${f(d.accretion.proFormaEPS, 2)}`,
  ].join(' ');
}
