import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtScaled, pickScale, fmtPct, fmtPctFloor, nonGaapFigures, isBankDeal, isRestaurant } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';

// Lighter shade of SF_BLUE used for the target segment of each stacked bar.
const TARGET_BLUE = '#A8C4DC';

// Compute the two-sided contribution split for a single metric.
// Guards: if a + b <= 0 (e.g., both zero, or a negative value makes the base
// meaningless) we flag the metric as not-meaningful rather than show a
// nonsensical percentage. A single negative value also makes the split
// not-meaningful since a 100%-stacked share of a negative base is misleading.
function splitContribution(a, b) {
  const aNum = parseFloat(a) || 0;
  const bNum = parseFloat(b) || 0;
  const total = aNum + bNum;
  if (total <= 0 || aNum < 0 || bNum < 0) {
    return { aVal: aNum, bVal: bNum, aPct: null, bPct: null, nm: true };
  }
  return { aVal: aNum, bVal: bNum, aPct: (aNum / total) * 100, bPct: (bNum / total) * 100, nm: false };
}

export function SectionRelativeContribution({ target, acquirer, deal, model, pageNum, exhibitLabel }) {
  const aName = acquirer.name || acquirer.ticker || 'Acquirer';
  const bName = target.name || target.ticker || 'Target';

  // ── Standalone inputs (all $M) ──────────────────────────────────────────────
  const aRev = parseFloat(acquirer.revenue) || 0;
  const bRev = parseFloat(target.revenue) || 0;
  // Gross profit from the filing. If either side has none, the row is omitted: a split needs both sides.
  const aGP = parseFloat(acquirer.grossProfit), bGP = parseFloat(target.grossProfit);
  const gpAvailable = Number.isFinite(aGP) && Number.isFinite(bGP);
  // Operating income on the DECK'S basis (so §I agrees with §4/§5/§6): reported NON-GAAP operating
  // income when the deal is non-GAAP (same /api/nongaap figures §5 shows — e.g. TEAM +$1,287M), else
  // GAAP operating income. NOT EBITDA (which is negative for loss-making filers → false "n/m").
  const ngA = deal?.basis === 'Non-GAAP' ? nonGaapFigures(acquirer) : null;
  const ngB = deal?.basis === 'Non-GAAP' ? nonGaapFigures(target)   : null;
  const aOI = ngA?.operatingIncome ?? (parseFloat(acquirer.operatingIncome) || 0);
  const bOI = ngB?.operatingIncome ?? (parseFloat(target.operatingIncome)   || 0);
  const oiNonGaap = ngA?.operatingIncome != null && ngB?.operatingIncome != null;
  // ── Free Cash Flow (Fix 3): prefer the fetched EDGAR FCF from the verified-data layer; fall
  //    back to the net-income proxy ONLY when a side's fetched FCF is genuinely missing. The proxy
  //    is misleading for growth-stage targets (e.g. TEAM net income is negative but FCF is +$1.5B,
  //    which previously forced the split to n/m). ───────────────────────────────────────────────
  const { data: aVerified } = useVerifiedData(acquirer?.ticker ?? null);
  const { data: bVerified } = useVerifiedData(target?.ticker ?? null);
  const aFetchedFCF = aVerified?.fields?.freeCashFlow?.value ?? null;
  const bFetchedFCF = bVerified?.fields?.freeCashFlow?.value ?? null;
  const aFCF = aFetchedFCF != null ? parseFloat(aFetchedFCF) : (parseFloat(acquirer.netIncome) || 0);
  const bFCF = bFetchedFCF != null ? parseFloat(bFetchedFCF) : (parseFloat(target.netIncome) || 0);
  const fcfFromProxy = aFetchedFCF == null || bFetchedFCF == null; // label honestly if either side fell back
  const fcfLabel = fcfFromProxy ? 'Free Cash Flow (est. ≈ Net Income)' : 'Free Cash Flow';
  console.log(
    `[§10 FCF] acq=${acquirer.ticker} NIproxy=${parseFloat(acquirer.netIncome) || 0} fetchedFCF=${aFetchedFCF ?? 'null'} -> use=${aFCF} | ` +
    `tgt=${target.ticker} NIproxy=${parseFloat(target.netIncome) || 0} fetchedFCF=${bFetchedFCF ?? 'null'} -> use=${bFCF} | ` +
    `CONSUMED=${fcfFromProxy ? 'NIproxy(fallback)' : 'fetchedFCF'}`
  );

  // ── Target ownership % — used ONLY by the thesis line below (the "for Z% of combined equity"
  //    comparison that is the analytical point of a contribution slide). Ownership is NOT charted here;
  //    it is the §H donut. Same C1 source (src/lib/deckModel.js) so the thesis % matches §H. ──
  const d = model?.derived || {};
  // Issuance chain reads deckModel's single source ONLY — no local re-derivation (Stage 11-C). deckModel
  // returns null for all of these when the acquirer price is absent (share issuance not derivable); that
  // null must survive to the render as "—", never be re-derived into a fabricated 0-share / 100%-0% split.
  const totalShares = d.proFormaShares;
  const tgtOwnPct = d.ownershipNewPct;
  const acqOwnPct = d.ownershipExistingPct;
  const ownUnknown = acqOwnPct == null || tgtOwnPct == null;   // acquirer price absent → equity split not derivable → "—"
  const ownNm = totalShares != null && totalShares <= 0;       // genuine zero/negative base — distinct from unknown
  // Faculty (7D-3a): the stock-consideration mix (X%) drives the PF-ownership label — from the deal input, NOT
  // hardcoded. stockPercent = 100 − cashPercent; the ownership above is computed at THIS mix.
  const stockPct = model?.dealAssumptions?.stockPercent ?? (deal?.cashPercent != null ? 100 - (parseFloat(deal.cashPercent) || 0) : null);

  // ── Bank deals: gross profit and operating income don't apply (and the 65%×revenue gross-profit
  //    fallback would be fabricated). Use the bank income stack instead — Net Interest Income, Total
  //    Revenue, Net Income — from the threaded bank facts / filings (same source as §4/§5). ──────────
  const bankMode = isBankDeal(target, acquirer);
  // Restaurant deals: drop the gross-profit contribution row (its false ~74%/65% margin skews the split) —
  // run the split on Revenue / Operating Income / FCF only. Single source: isRestaurant (Fix B).
  const restaurantDeal = isRestaurant(target) || isRestaurant(acquirer);
  const aNII = parseFloat(acquirer.netInterestIncome) || 0;
  const bNII = parseFloat(target.netInterestIncome) || 0;
  const aNI  = parseFloat(acquirer.netIncome) || 0;
  const bNI  = parseFloat(target.netIncome) || 0;

  // ── Metric rows ─────────────────────────────────────────────────────────────
  // CONTRIBUTION metrics only. Ownership (the equity split) is a DIFFERENT concept and lives on §H as a
  // donut — it is deliberately NOT a bar here (contribution ≠ ownership; do not conflate the two).
  const metrics = bankMode ? [
    { label: 'Net Interest Income', isMoney: true, ...splitContribution(aNII, bNII) },
    { label: 'Total Revenue',       isMoney: true, ...splitContribution(aRev, bRev) },
    { label: 'Net Income',          isMoney: true, ...splitContribution(aNI, bNI) },
  ] : [
    { label: 'Revenue', isMoney: true, ...splitContribution(aRev, bRev) },
    // Restaurant deals: omit gross profit (false ~74%/65% margin) — never feed it into the split.
    (restaurantDeal || !gpAvailable) ? null : { label: 'Gross Profit', isMoney: true, ...splitContribution(aGP, bGP) },
    { label: `Operating Income (${oiNonGaap ? 'Non-GAAP' : 'GAAP'})`, isMoney: true, ...splitContribution(aOI, bOI) },
    { label: fcfLabel, isMoney: true, ...splitContribution(aFCF, bFCF) },
  ].filter(Boolean);

  // Thesis sentence (spec §2 Slide 11): "{Acquirer} acquires 100% of {Target}, which contributes
  // X–Y% of pro forma financials, for Z% of combined equity." Range = target's contribution across
  // the meaningful $ metrics; Z = target ownership. All inputs already computed above.
  // Uniform table scale: pick ONE unit from all money values across both companies so the underlying-
  // values table never mixes $B and $M (fmtMoneyTable auto-switched per value at $10B). Stays in $M when
  // a small target value is present, so it never collapses to "$0.xB" and loses the target's signal.
  const moneyScale = pickScale(metrics.filter((m) => m.isMoney).flatMap((m) => [m.aVal, m.bVal]));
  const moneyScaleLabel = moneyScale === 'B' ? '$B' : '$M';

  const moneyPcts = metrics.filter(m => m.isMoney && !m.nm && m.bPct != null).map(m => m.bPct);
  const thesis = (moneyPcts.length && !ownNm && !ownUnknown)
    ? `${aName} acquires 100% of ${bName}, which contributes ${Math.round(Math.min(...moneyPcts))}–${Math.round(Math.max(...moneyPcts))}% of pro forma financials, for ${fmtPctFloor(tgtOwnPct, 0)} of combined equity.`
    : null;

  const gpPhrase = gpAvailable
    ? 'gross profit from SEC filings'
    : 'gross profit omitted (not available from the filings of both companies)';
  const fcfClause = fcfFromProxy ? 'free cash flow estimated (≈ net income)' : 'free cash flow from SEC EDGAR cash-flow statements';
  const oiClause = oiNonGaap
    ? 'operating income is reported Non-GAAP (per the fiscal year-end earnings 8-K, matching the standalone P&L)'
    : 'operating income is GAAP (SEC filings)';
  const sourceLine = bankMode
    ? 'Net interest income, total revenue, and net income as reported in SEC filings (10-K / earnings release). ' +
      'Contribution is each company’s share of the combined financials; the equity split is shown separately on the Trading Profile slide.'
    : `Revenue from SEC EDGAR; ${restaurantDeal ? 'gross profit omitted (restaurant cost structure — food-only COGS not separately meaningful)' : gpPhrase}; ${fcfClause}; ${oiClause}. ` +
      'Contribution is each company’s share of the combined financials; the equity split is shown separately on the Trading Profile slide.';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Relative Contribution Analysis"
        subtitle={`${aName} and ${bName} — share of combined entity by metric`}
      />

      <div style={{ padding: '16px 20px 36px' }}>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, background: SF_BLUE, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#374151' }}>{aName} (Acquirer)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, background: TARGET_BLUE, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#374151' }}>{bName} (Target)</span>
          </div>
        </div>

        {/* ── 100% stacked bars per metric ────────────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          {metrics.map((m, i) => (
            <div key={m.label} style={{ marginBottom: i === metrics.length - 1 ? 0 : 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {m.label}
                </span>
                {m.nm && (
                  <span style={{ fontSize: 9, fontStyle: 'italic', color: '#DC2626' }}>
                    n/m — split not meaningful (zero or negative base)
                  </span>
                )}
              </div>

              {m.nm ? (
                <div style={{
                  height: 26,
                  borderRadius: 4,
                  border: `1px dashed ${GRAY_BORDER}`,
                  background: ALT_ROW,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>n/m</span>
                </div>
              ) : (() => {
                // Both slices are ALWAYS labeled (Fix 10c): wide slices (≥12%) get a label inside;
                // thin slices (e.g. a 7.3% target stake) get a label just OUTSIDE the bar edge in the
                // slice's color, so no slice is left unlabeled by the inside-only 8% threshold.
                const aWide = m.aPct >= 12;
                const bWide = m.bPct >= 12;
                return (
                <div style={{ position: 'relative', height: 26 }}>
                  <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', border: `1px solid ${GRAY_BORDER}` }}>
                    <div style={{ width: `${m.aPct}%`, background: SF_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
                      {aWide && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{fmtPct(m.aPct, 0)}</span>
                      )}
                    </div>
                    <div style={{ width: `${m.bPct}%`, background: TARGET_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
                      {bWide && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{fmtPct(m.bPct, 0)}</span>
                      )}
                    </div>
                  </div>
                  {!aWide && (
                    <span style={{ position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 4, fontSize: 10, fontWeight: 700, color: SF_BLUE, whiteSpace: 'nowrap' }}>
                      {fmtPct(m.aPct, 0)}
                    </span>
                  )}
                  {!bWide && (
                    <span style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 4, fontSize: 10, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>
                      {fmtPct(m.bPct, 0)}
                    </span>
                  )}
                </div>
                );
              })()}
            </div>
          ))}

          {/* ── Pro Forma Ownership bar (the EQUITY split) — set apart from the contribution bars above,
              because contribution ≠ ownership; the point of the slide is comparing the two. ── */}
          {!ownNm && (
            <div style={{ marginTop: 4, paddingTop: 12, borderTop: `1px dashed ${GRAY_BORDER}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5 }}>{stockPct != null ? `PF ownership per the ${Math.round(stockPct)}% stock consideration offer` : 'Pro Forma Ownership (equity)'}</span>
                <span style={{ fontSize: 9, fontStyle: 'italic', color: '#6B7280' }}>equity split — compare vs. contribution above</span>
              </div>
              <div style={{ position: 'relative', height: 26 }}>
                {ownUnknown ? (
                  /* Acquirer price absent → equity split not derivable. One neutral bar reading "—",
                     never a fabricated 100%/0% split (Stage 11-C). */
                  <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', border: `1px solid ${GRAY_BORDER}`, background: ALT_ROW, alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', whiteSpace: 'nowrap' }}>—</span>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', border: `1px solid ${GRAY_BORDER}` }}>
                      <div style={{ width: `${acqOwnPct}%`, background: SF_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
                        {acqOwnPct >= 12 && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{fmtPct(acqOwnPct, 0)}</span>}
                      </div>
                      <div style={{ width: `${tgtOwnPct}%`, background: TARGET_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 }}>
                        {tgtOwnPct >= 12 && <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{fmtPct(tgtOwnPct, 0)}</span>}
                      </div>
                    </div>
                    {acqOwnPct < 12 && <span style={{ position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 4, fontSize: 10, fontWeight: 700, color: SF_BLUE, whiteSpace: 'nowrap' }}>{fmtPctFloor(acqOwnPct, 0)}</span>}
                    {tgtOwnPct < 12 && <span style={{ position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 4, fontSize: 10, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{fmtPctFloor(tgtOwnPct, 0)}</span>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Thesis sentence (spec §2 Slide 11) ──────────────────────────────── */}
        {thesis && (
          <div style={{
            margin: '0 0 16px', padding: '10px 14px', borderLeft: `3px solid ${SF_BLUE}`,
            background: ALT_ROW, borderRadius: 4, fontSize: 12, color: NAVY, lineHeight: 1.5, fontWeight: 600,
          }}>
            {thesis}
          </div>
        )}

        {/* ── Underlying $ / share values table ───────────────────────────────── */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Underlying Values ({moneyScaleLabel})
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
            <span style={{ flex: 2.4, color: '#fff', fontSize: 10, fontWeight: 700 }}>Metric</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{aName}</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{bName}</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{aName} %</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{bName} %</span>
          </div>

          {metrics.map((m, i) => {
            const aDisp = m.isMoney ? fmtScaled(m.aVal, moneyScale) : `${(parseFloat(m.aVal) || 0).toFixed(1)}M sh`;
            const bDisp = m.isMoney ? fmtScaled(m.bVal, moneyScale) : `${(parseFloat(m.bVal) || 0).toFixed(1)}M sh`;
            const aPctDisp = m.nm ? 'n/m' : fmtPct(m.aPct, 1);
            const bPctDisp = m.nm ? 'n/m' : fmtPct(m.bPct, 1);
            return (
              <div key={m.label} style={{ display: 'flex', padding: '5px 10px', background: i % 2 === 1 ? ALT_ROW : '#fff', borderBottom: i === metrics.length - 1 ? 'none' : `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2.4, fontSize: 11, color: '#374151' }}>{m.label}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{aDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{bDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: m.nm ? '#DC2626' : SF_BLUE }}>{aPctDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: m.nm ? '#DC2626' : NAVY }}>{bPctDisp}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source line */}
      <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
