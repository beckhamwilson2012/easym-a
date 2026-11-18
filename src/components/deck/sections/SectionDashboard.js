import { useState, useRef } from 'react';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { VerifiedValue, StatusDot } from '../../shared/VerifiedValue';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  computeFlags, buildNarrative, newSharesLabel,
  calcProFormaEPS, proFormaBreakdown, SYN_MULTS, SYN_LABELS,
  acquirerSharePrice, targetMarketPrice, acquirerStandaloneEPS,
} from '../../../utils/dealCalc';
import { calcStockIssuancePct, triggers199Rule } from '../../../lib/dealMath';
import {
  isBankDeal, calcPTBV, combinedCET1, computeBankFlags, buildBankNarrative,
  fmtRatio, fmtPct, fmtMoneyTable, fmtMoneyDual, fmtMoneyAccounting, fmtPerShare, fmtPctSigned, fmtInterest, epsVsBreakeven,
} from '../shared/deckTokens';
import { useWindowWidth } from '../../../hooks/useWindowWidth';
import { ExplainButton } from '../../shared/ExplainButton';
import { SynergyLines } from '../shared/SynergyLines';
import { BasisNote } from '../shared/BasisNote';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { accretionShareCountLabel } from '../../../lib/composeSourceLine';
import { DIFFERENT_BASES } from '../../../lib/companyBasis';
import { balanceSheetGap, dealBalanceSheetGap } from '../../../lib/netDebt';
import { multipleNumber } from '../../../lib/multiples';
import { isNonGaapDeal, FY_ONLY, computedSides, epsSourceText, combinedEbitdaShort } from '../../../lib/reportingBasis';
import { NONE_ENTERED, fmtSynergy } from '../../../lib/synergies';
import { useDealVerdict, VerdictBlock } from '../shared/useDealVerdict';
import { verdictFlags, headlineEps, reportedEpsReference, dealEpsMethodText } from '../../../lib/dealVerdict';
import {
  explainEvEbitda, explainPeRatio, explainDebtEbitda,
  explainPTBV, explainCombinedCET1,
  explainEpsChange,
  explainDealSize, explainSynergies,
  explainCashPercent,
} from '../../../lib/explanations';

// SectionDashboard does NOT use PageFrame — it keeps the original dashboard styling.
// Fix 16 Task 8: slide-scale type for the printed Deal Summary only (scoped to the PDF render; the screen is unchanged).
const PDF_DASH_CSS = [
  '[data-pdf-dash] h3 { font-size: 13px !important; margin: 0 0 4px !important; }',
  '[data-pdf-dash] p { margin-bottom: 4px !important; }',
  '[data-pdf-dash] [data-testid="eps-basis-note"], [data-pdf-dash] [data-testid="eps-analysis-label"], [data-pdf-dash] [data-testid="pf-year-note"] { margin-top: 0 !important; margin-bottom: 4px !important; }',
  ...['36', '32', '30', '28'].map((n) => `[data-pdf-dash] [style*="font-size: ${n}px"] { font-size: 18px !important; }`),
  ...['24', '22', '20'].map((n) => `[data-pdf-dash] [style*="font-size: ${n}px"] { font-size: 15px !important; }`),
  ...['16', '15', '14'].map((n) => `[data-pdf-dash] [style*="font-size: ${n}px"] { font-size: 11px !important; }`),
  ...['13', '12'].map((n) => `[data-pdf-dash] [style*="font-size: ${n}px"] { font-size: 10px !important; }`),
].join('\n');

export function SectionDashboard({ target, acquirer, deal, onEditInputs, onNewAnalysis, onSaveAnalysis, forPdf = false, pageNum, exhibitLabel }) {
  const { _results: results, _inputs: inputs, _nameA: nameA, _nameB: nameB } = deal;
  const [pdfLoading, setPdfLoading] = useState(false);
  const pdfRef = useRef(null);
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;

  const { data: verifiedTarget } = useVerifiedData(target?.ticker ?? null);
  const verdict = useDealVerdict({ deal, acquirer, target });

  if (!results || !inputs) return null;

  // GAAP | Non-GAAP plan (src/lib/reportingBasis.js) — null on a GAAP deal, which leaves every label below as it was.
  const ngPlan = isNonGaapDeal(deal) ? deal.reportingBasis : null;
  const epsMethod = dealEpsMethodText(deal, ngPlan?.tickers?.A || acquirer?.ticker || nameA);   // Fix 19 Task 5
  const ebB = ngPlan ? ngPlan.ebitda.B : null;
  const ebitdaBasisText = (e) => (e.nonGaap ? (e.computed ? `${e.name} (non-GAAP, computed by EasyM&A)` : `${e.name} (non-GAAP)`) : 'computed EBITDA');
  const ebDiffer = !!(ngPlan && results.ebitdaBasesDiffer);
  const combinedEbitdaBasis = ngPlan ? (ebDiffer ? null : (ngPlan.ebitda.A.nonGaap ? 'non-GAAP' : 'computed')) : null;
  // Fix 13: a non-GAAP combined EBITDA with a computed side names each company's source; null when both are company reported.
  const ebSources = ngPlan && !ebDiffer && (ngPlan.ebitda.A.computed || ngPlan.ebitda.B.computed) ? combinedEbitdaShort(ngPlan) : null;

  const bankMode = isBankDeal(target, acquirer);
  // Fix 21 Task 2: a missing figure is neither loading nor negative. The tiles below print "—" and say what is absent.
  const absentFigure = (v) => !Number.isFinite(parseFloat(v));
  const tgtTk = target?.ticker || nameB, acqTk = acquirer?.ticker || nameA;
  const tgtBsGap = balanceSheetGap(tgtTk, target);   // Fix 21 Task 4: why EV, net debt and leverage are "—"
  const dealBsGap = dealBalanceSheetGap(acqTk, acquirer, tgtTk, target);
  // Leverage needs the debt too: when it is missing as well, the tile names that reason beside any other.
  const withBsGap = (t) => (results.combinedDebt == null && dealBsGap ? `${t}; ${dealBsGap}` : t);
  const cet1Why = (c, tk) => ((c?.totalAssets != null || c?.tangibleBookValue != null || c?.netInterestIncome != null)
    ? `${tk}: no CET1 ratio tagged in its XBRL filings` : `${tk}: bank filing data not available`);
  const cet1Tile = (() => {
    const tC = target?.cet1Ratio ?? null, aC = acquirer?.cet1Ratio ?? null;
    if (tC != null && aC != null) {
      const combined = combinedCET1(target, acquirer);
      return combined != null ? { value: fmtPct(combined * 100) } : { value: '—', note: 'risk-weighted assets not tagged, so the two ratios cannot be weighted' };
    }
    if (tC != null) return { value: `Target: ${fmtPct(tC * 100)} · Acquirer: —`, note: cet1Why(acquirer, acqTk) };
    if (aC != null) return { value: `Acquirer: ${fmtPct(aC * 100)} · Target: —`, note: cet1Why(target, tgtTk) };
    return { value: '—', note: `${cet1Why(acquirer, acqTk)}; ${cet1Why(target, tgtTk)}` };
  })();
  const flags     = bankMode
    ? computeBankFlags(results, inputs, target, acquirer)
    : computeFlags(results, inputs);
  // Third state for undefined accretion: a non-positive EPS base makes accretive/(dilutive) meaningless.
  // Drive the verdict off accretionMeaningful (NOT isAccretive being falsy) so an EPS IMPROVEMENT off a
  // negative base (e.g. -$0.37 → -$0.18) never reads "Dilutive". Positive-base deals are unchanged.
  // One EPS story (Fix 14 Task 3): the tile and EPS Analysis show the verdict's own year (headlineEps), each labeled with
  // its year and basis. When Year 1 is "—" that is the forecast year the verdict used, never a bare "n/m".
  const hEps        = headlineEps(verdict, deal);
  // Fix 20 Task 3: the sentence under the headline reads the same headline object (year, basis, EPS), never Year 1 beside it.
  const narrative  = bankMode
    ? buildBankNarrative(results, inputs, target, acquirer, nameA, nameB)
    : buildNarrative(results, inputs, acquirer?.name || nameA, target?.name || nameB, flags, hEps);   // the names every other slide uses
  const epsRef      = results.basesDiffer ? null : reportedEpsReference(hEps, deal);   // Fix 17 Task 1: the company's own figure, a labeled reference
  // Fix 21 Task 6: companies on different bases have no Year 1 figure, but a forward-year verdict has its own.
  const y1Blocked   = results.basesDiffer && !(hEps.fromVerdict && hEps.year !== 'Year 1');
  const accOK       = hEps.pct != null;
  const accUp       = hEps.verdict === 'accretive';
  const accColor    = !accOK ? '#6B7280' : accUp ? '#16A34A' : hEps.verdict === 'neutral' ? '#374151' : '#DC2626'; // dark green / red
  const accColorL   = !accOK ? '#9CA3AF' : accUp ? '#4ADE80' : hEps.verdict === 'neutral' ? '#fff' : '#F87171'; // light (on navy)
  // Fix 16 Task 8: the printed Deal Summary is a slide like every other page (PageFrame header and footer, 850px wide), so
  // its cards and rows are tighter there. On screen every value below is what it was.
  const mb = forPdf ? 8 : 24, rowPad = forPdf ? '2px 0' : '8px 0', rowFont = forPdf ? 10.5 : 13, cellPad = forPdf ? '2px 6px' : '8px 10px';
  const cardStyle    = { background: '#fff', borderRadius: forPdf ? 6 : 12, padding: forPdf ? '8px 12px' : 24, border: '1px solid #E5E7EB' };
  const col2         = { display: 'grid', gridTemplateColumns: isMobile && !forPdf ? '1fr' : '1fr 1fr', gap: forPdf ? 8 : 24, marginBottom: mb };

  // Stock issuance risk flags
  const acquirerSharePx = acquirerSharePrice(inputs);
  const stockIssuancePct = calcStockIssuancePct({
    dealSize: parseFloat(results.totalPurchasePrice) || 0,
    cashPercent: inputs.cashPercent,
    acquirerSharePrice: acquirerSharePx,
    acquirerSharesOutstanding: inputs.companyAShares,
  });
  const stockFlags = [];
  if (stockIssuancePct != null && stockIssuancePct >= 50) {
    stockFlags.push({ level: 'critical', icon: '🔴', text: `Stock issuance ${stockIssuancePct.toFixed(1)}% of acquirer pre-deal shares — majority-stock deal triggers heightened board scrutiny and potential rating-agency review.` });
  } else if (triggers199Rule(stockIssuancePct)) {
    stockFlags.push({ level: 'warning', icon: '⚠️', text: `Stock issuance ${stockIssuancePct.toFixed(1)}% of acquirer pre-deal shares — exceeds 19.9% NYSE/Nasdaq threshold, requiring acquirer shareholder vote (NYSE §312.03 / Nasdaq Rule 5635).` });
  }
  // Verdict flags first (Fix 10 Task 6): a dilutive verdict or a synergy gap is never "structurally sound".
  const allFlags = [...verdictFlags(verdict), ...flags, ...stockFlags];

  // Enterprise value / combined debt (for explainers) — dealCalc's own numerators, null when a leg is unavailable.
  const ev = results.enterpriseValue;
  const combinedDebtForExplain = results.combinedDebt;
  // P/E explainer: per share for a public target; equity value ÷ net income for a private one (dealCalc peBasis).
  const peExplainArgs = results.peBasis
    ? { equityValue: parseFloat(results.totalPurchasePrice), netIncome: inputs.companyBNetIncome, multiple: results.peRatio }
    : { offerPrice: inputs.offerPricePerShare, eps: inputs.companyBEPS, multiple: results.peRatio };
  const newSharesText = newSharesLabel(results);   // "—" with the reason, never "nullM"

  // One year everywhere (Fix 16 Task 3). When the verdict's year is a forecast year (Year 1 is "—"), the sensitivity grid,
  // the cash-structure strip and the pro forma income statement use that year's inputs and synergy (the verdict's own,
  // dealVerdict step 2), labeled with the year. Otherwise every table is Year 1, exactly as before.
  const vYear = verdict && verdict.step === 2 && verdict.inputs ? verdict : null;
  const sInputs = vYear ? vYear.inputs : inputs;
  const sSyn = vYear ? vYear.synergy : results.synergiesY1;
  const vYearNote = vYear ? `Year 1 is "—" (${results.basesDiffer ? DIFFERENT_BASES : inputs.year1Reason || 'Year 1 EPS not available'}), so this uses ${hEps.label}, the verdict's year.` : null;

  // Cash sensitivity strip: pro forma EPS at 100/80/60/40/20% cash
  const cashSensitivity = [100, 80, 60, 40, 20].map(cp => ({
    cashPct: cp,
    eps: calcProFormaEPS(inputs.offerPricePerShare, sSyn, { ...sInputs, cashPercent: cp }),
  }));

  // Synergy reference for sensitivity: the Year 1 total as entered. With none entered there is nothing to flex, so
  // every column is the same no-synergy EPS and the page says so.
  const synergyY1Entered = vYear ? vYear.synergyEntered : results.synergies.years[0].entered;
  // The verdict year's pro forma lines (null on Year 1, where the results above are that year's).
  const vYearPF = vYear ? proFormaBreakdown(inputs.offerPricePerShare, sSyn, sInputs) : null;
  // Lost interest on cash used (Fix 14 Task 2): dealCalc.financingCost's after-tax figure, beside the financing cost.
  // Unknown → shown as "—"; a deal that uses no cash shows no row, as the financing cost does at zero.
  const lostInterestRows = results.lostInterestAfterTax == null ? [{ label: 'Lost interest on cash used (after-tax)', value: '—' }]
    : results.lostInterestAfterTax > 0 ? [{ label: `Lost interest on cash used (after-tax, ${results.cashYield?.assumption ? results.cashYield.label : `${(results.cashYield.rate * 100).toFixed(1)}% realized yield`})`, value: `(${fmtInterest(results.lostInterestAfterTax)})`, red: true }] : [];
  const synSensBase = sSyn;

  // Build a 5-row premium ladder for the sensitivity grid. Center on the deal's ACTUAL premium when
  // it is a sane positive number; otherwise fall back to a standard 10/15/20/25/30% acquisition
  // ladder. Always produce 5 DISTINCT, escalating, non-negative premiums — never collapse to
  // identical rows (the old `Math.max(0, p)` clamp turned a negative premium into five 0% rows).
  const rawPremium = results.purchasePremium != null ? parseFloat(results.purchasePremium) : null;
  const havePremium = rawPremium != null && isFinite(rawPremium) && rawPremium >= 5 && rawPremium <= 150;
  const pivot = havePremium ? Math.round(rawPremium / 5) * 5 : 20;
  let rowPremiums = [pivot - 10, pivot - 5, pivot, pivot + 5, pivot + 10];
  const minRow = Math.min(...rowPremiums);
  if (minRow < 5) rowPremiums = rowPremiums.map(p => p + (5 - minRow)); // floor at 5% so rows stay positive & distinct
  const sensitivityCurrentRow = 2; // center row is the base case (the deal premium when available)

  // Target market price (basis for premium calculation — same real-price basis as dealCalc.js).
  // Falls back to deriving from the offer + premium only when no real price is available at all.
  const targetMktPrice = targetMarketPrice(inputs) > 0
    ? targetMarketPrice(inputs)
    : inputs.offerPricePerShare > 0 ? inputs.offerPricePerShare / (1 + rawPremium / 100) : inputs.offerPricePerShare;

  const rowOfferPrices = rowPremiums.map(prem =>
    targetMktPrice > 0 ? targetMktPrice * (1 + prem / 100) : inputs.offerPricePerShare
  );

  const sensitivityData = rowOfferPrices.map(offerPrice =>
    SYN_MULTS.map(sm => calcProFormaEPS(offerPrice, synSensBase * sm, sInputs))
  );

  // Footer: find minimum synergy level for accretion on current row
  const breakevenEPS = acquirerStandaloneEPS(sInputs); // net income ÷ shares (matches calculate())
  const currentRowData = sensitivityData[sensitivityCurrentRow] || [];
  let sensitivityFooter = null;
  if (y1Blocked) {
    sensitivityFooter = `Pro forma EPS is not shown: ${DIFFERENT_BASES}.`;
  } else if (!synergyY1Entered) {
    sensitivityFooter = `No Year 1 synergies entered, so every column shows EPS with no synergies assumed.`;
  } else if (breakevenEPS > 0 && currentRowData.length > 0) {
    const firstAccretiveIdx = currentRowData.findIndex(eps => eps !== null && eps >= breakevenEPS);
    if (firstAccretiveIdx === -1) {
      // Find minimum synergy mult needed (extrapolate beyond 150%)
      sensitivityFooter = `Deal is dilutive across all synergy scenarios at the current offer price. Synergy realization beyond 150% would be required to break even.`;
      // Reconcile with the §7 multi-year ramp (Fix 9): this grid is a Year-1 SNAPSHOT — it varies the
      // Year-1 synergy run-rate only up to 150%. The Year-2/3 synergies ramp far higher, so the deal
      // can be dilutive across this grid yet turn accretive by Year 3 (no contradiction).
      const y3EPS = calcProFormaEPS(inputs.offerPricePerShare, results.synergiesY3, inputs);
      if (y3EPS != null && y3EPS > breakevenEPS) {
        sensitivityFooter += ` Note: the grid reflects Year-1 synergies only; as synergies ramp to their full run-rate the deal turns accretive by Year 3 (see Pro Forma P&L accretion table).`;
      }
    } else if (firstAccretiveIdx === 0) {
      sensitivityFooter = `Deal remains accretive across all synergy scenarios at the current offer price.`;
    } else if (firstAccretiveIdx <= SYN_MULTS.indexOf(1)) {
      // Fix 16 Task 6: only when the deal is accretive at 100% realization; a deal already dilutive at the announced figure
      // has no realization it "can fall to" (the verdict and breakeven say where it breaks even).
      const breakMult = SYN_MULTS[firstAccretiveIdx];
      const breakPct = Math.round(breakMult * 100);
      sensitivityFooter = `Synergy realization can fall to ~${breakPct}% of the announced figure before the deal turns dilutive (breakeven EPS: ${fmtPerShare(breakevenEPS)}).`;
    }
  }

  const handleExportPDF = async () => {
    if (!pdfRef.current) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(pdfRef.current, { scale: 2, useCORS: true, backgroundColor: '#F4F6F9' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      const pageH = pdf.internal.pageSize.getHeight();
      let remaining = pdfH;
      let yPos = 0;
      pdf.addImage(imgData, 'PNG', 0, yPos, pdfW, pdfH);
      remaining -= pageH;
      while (remaining > 0) {
        yPos -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, yPos, pdfW, pdfH);
        remaining -= pageH;
      }
      pdf.save(`deal-${(nameA || 'A').replace(/\s+/g, '-')}-${(nameB || 'B').replace(/\s+/g, '-')}.pdf`);
    } finally {
      setPdfLoading(false);
    }
  };

  const body = (
      <div ref={pdfRef}>
        {/* Verdict banner */}
        <div style={{ background: '#0F2244', borderRadius: forPdf ? 6 : 12, padding: forPdf ? '8px 14px' : 20, marginBottom: forPdf ? 8 : 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ color: '#A8C4DC', fontSize: 13 }}>Deal verdict</div>
            <VerdictBlock verdict={verdict} dark size={isMobile ? 22 : 28} />
            {bankMode && (
              <div style={{ marginTop: 6, display: 'inline-block', background: '#1B4B8A', border: '1px solid #3B82F6', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: '#93C5FD', letterSpacing: 0.3 }}>
                Bank M&A Mode
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#A8C4DC', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                EPS Impact
                <ExplainButton explain={() => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA })} />
              </div>
              <div data-testid="eps-impact-tile" style={{ color: accColorL, fontSize: 22, fontWeight: 'bold' }}>
                {accOK ? fmtPctSigned(hEps.pct) : 'n/m'}
              </div>
              <div data-testid="eps-impact-label" style={{ color: '#A8C4DC', fontSize: 10, marginTop: 2 }}>{hEps.label}{!accOK && hEps.reason ? ` — ${hEps.reason}` : ''}</div>
            </div>
          </div>
        </div>

        {/* Narrative */}
        <div style={{ ...cardStyle, marginBottom: mb, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <p style={{ margin: 0, fontSize: forPdf ? 11 : 14, color: '#1E3A5F', lineHeight: forPdf ? 1.4 : 1.7 }}>{narrative}</p>
          <BasisNote acquirer={acquirer} target={target} deal={deal} fixed={accretionShareCountLabel(deal?._inputs)} style={{ marginTop: 6, fontSize: 11 }} />
        </div>

        {/* Key metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile && !forPdf ? '1fr' : '1fr 1fr 1fr', gap: forPdf ? 8 : 16, marginBottom: mb }}>
          {(bankMode ? [
            {
              label: 'P / TBV',
              value: calcPTBV(target) != null ? fmtRatio(calcPTBV(target)) : '—',
              // Fix 21 Task 2: the deck is built, so nothing here is still loading. Say which input is absent.
              note: calcPTBV(target) != null ? null
                : target?.tangibleBookValue ? `${tgtTk}: equity value not available`
                : `${tgtTk}: tangible book value not available`,
              explain: () => explainPTBV({ marketCap: target?.marketCap, tangibleBookValue: target?.tangibleBookValue, ratio: calcPTBV(target), companyName: nameB }),
            },
            {
              label: 'P / E at offer price',   // Fix 14 Task 4: dealCalc's P/E is the offer (not the market price) ÷ target EPS
              value: results.peRatio === 'N/A' ? (results.peAbsent ? '—' : 'n/m') : `${multipleNumber(results.peRatio)}x`,
              note:  results.peRatio === 'N/A' ? results.peReason : null,   // dealCalc names the real reason
              explain: () => explainPeRatio(peExplainArgs),
            },
            {
              label: 'CET1 (Combined)',
              ...cet1Tile,
              explain: () => explainCombinedCET1({ targetCET1: target?.cet1Ratio, acquirerCET1: acquirer?.cet1Ratio, targetRWA: target?.riskWeightedAssets, acquirerRWA: acquirer?.riskWeightedAssets }),
            },
          ] : [
            {
              label: 'EV / EBITDA at offer price',   // Fix 19 Task 5: EV = offer equity value − net cash, like the P/E tile
              // "n/m" (not meaningful): a multiple off a negative EBITDA has no economic meaning.
              // Fix 21 Task 2: "n/m" is a real zero or negative figure (or above the cap), with dealCalc's reason. No figure is "—".
              // `companyBEBITDA <= 0` read a missing EBITDA as negative (null <= 0 is true): OXY "Target EBITDA is negative".
              value: results.evEBITDA === 'N/A' ? (results.evEBITDAReason ? 'n/m' : '—') : `${multipleNumber(results.evEBITDA)}x`,
              note:  results.evEBITDA === 'N/A'
                ? (ebB && ebB.nonGaap && ebB.value == null ? `${ebB.name}: ${FY_ONLY}` : (results.evEBITDAReason || [absentFigure(inputs.companyBEBITDA) && 'Target EBITDA not reported', results.enterpriseValue == null && tgtBsGap].filter(Boolean).join('; ') || 'not available'))
                : (ebB ? `on ${ebitdaBasisText(ebB)}` : null),
              explain: () => explainEvEbitda({ ev, ebitda: inputs.companyBEBITDA, multiple: results.evEBITDA }),
            },
            {
              // Fix 14 Task 4: dealCalc's P/E is the offer price ÷ target EPS (a private target: purchase equity value ÷
              // net income), never the market price; the label says so.
              label: 'P / E at offer price',
              value: results.peRatio === 'N/A' ? (results.peAbsent ? '—' : 'n/m') : `${multipleNumber(results.peRatio)}x`,
              // The reason is dealCalc's (peReason): `companyBEPS <= 0` read a private target's default 0 EPS as negative earnings.
              note:  results.peRatio === 'N/A' ? results.peReason
                : results.peBasis ? results.peBasis
                : (ngPlan ? (ngPlan.eps.nonGaap ? (ngPlan.eps.B?.computed ? 'on adjusted EPS (non-GAAP, computed by EasyM&A)' : 'on adjusted EPS (non-GAAP)') : 'on GAAP EPS') : null),
              explain: () => explainPeRatio(peExplainArgs),
            },
            {
              label: 'Debt / EBITDA',
              value: (results.basesDiffer || ebDiffer) ? '—' : results.debtEBITDA === 'N/A' ? (results.debtEBITDAReason ? 'n/m' : '—') : `${multipleNumber(results.debtEBITDA)}x`,
              // Branch on WHY the ratio is N/A (dealCalc: combinedEBITDA > 0 && combinedDebt != null) — a null
              // combined debt with positive EBITDA is "debt not available", never "EBITDA is non-positive".
              note:  results.debtEBITDA === 'N/A'
                ? ((results.basesDiffer || ebDiffer) ? withBsGap(DIFFERENT_BASES) : results.debtEBITDAAboveCap ? results.debtEBITDAReason : results.combinedEBITDA == null ? withBsGap('Combined EBITDA not available')
                  : parseFloat(results.combinedEBITDA) <= 0 ? 'Combined EBITDA is non-positive'
                  : (dealBsGap || 'Combined debt not available'))
                : (combinedEbitdaBasis ? `on ${combinedEbitdaBasis} combined EBITDA${ebSources ? ` (${ebSources})` : ''}` : null),
              explain: () => explainDebtEbitda({ combinedDebt: combinedDebtForExplain, combinedEbitda: results.combinedEBITDA, multiple: results.debtEBITDA }),
            },
          ]).map(m => (
            <div key={m.label} style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {m.label}
                <ExplainButton explain={m.explain} />
              </div>
              <div style={{ fontSize: (m.value === 'n/m' || m.value === '—') ? 22 : 28, fontWeight: 'bold', color: (m.value === 'n/m' || m.value === '—') ? '#9CA3AF' : '#0F2244' }}>{m.value}</div>
              {m.note && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic' }}>{m.note}</div>}
            </div>
          ))}
        </div>

        {/* EPS Analysis + Pro Forma */}
        <div style={col2}>
          <div style={cardStyle}>
            <h3 style={{ color: '#0F2244', marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              EPS Analysis
              <ExplainButton explain={() => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA })} />
              <span style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                padding: '2px 8px', borderRadius: 10,
                background: (deal.basis === 'Non-GAAP') ? '#EFF6FF' : '#F3F4F6',
                color: (deal.basis === 'Non-GAAP') ? '#0070D2' : '#6B7280',
                border: `1px solid ${(deal.basis === 'Non-GAAP') ? '#BFDBFE' : '#E5E7EB'}`,
              }}>
                {(deal.basis || 'GAAP')} basis
              </span>
            </h3>
            {(ngPlan || epsMethod) && (
              <div data-testid="eps-basis-note" style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 12, fontStyle: 'italic' }}>
                {/* Fix 19 Task 5: the acquirer's part says which EPS the deal uses (net income ÷ the one share count), the reported figure as a reference. */}
                {!ngPlan ? `GAAP EPS — ${epsMethod}.`
                  : !ngPlan.eps.nonGaap ? `${ngPlan.eps.note}.`
                  : computedSides(ngPlan).length ? `Non-GAAP EPS — ${epsSourceText(ngPlan, {}, ngPlan.eps.A && !ngPlan.eps.A.computed && epsMethod ? { A: epsMethod } : {})}.`
                  : 'Non-GAAP EPS, company reported by both companies (fiscal-year earnings releases).'}
              </div>
            )}
            <div data-testid="eps-analysis-label" style={{ fontSize: 11, color: '#374151', fontWeight: 600, marginTop: -6, marginBottom: 10 }}>{hEps.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Before</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{y1Blocked ? '—' : fmtPerShare(hEps.standaloneEPS)}</div>
                {epsRef && <div data-testid="eps-reported-ref" style={{ fontSize: 10, color: '#6B7280', maxWidth: 170, lineHeight: 1.3 }}>{epsRef.text}</div>}
              </div>
              <div style={{ fontSize: 24, color: '#6B7280', alignSelf: 'center' }}>→</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>After</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: accColor }}>
                  {y1Blocked ? '—' : fmtPerShare(hEps.proFormaEPS)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Change</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: accColor }}>
                  {y1Blocked ? '—' : (accOK ? fmtPctSigned(hEps.pct) : 'n/m')}
                </div>
              </div>
            </div>
            <h3 style={{ color: '#0F2244', display: 'flex', alignItems: 'center', gap: 6 }}>
              {bankMode ? 'Cost Savings' : 'Synergies'}
              <ExplainButton explain={() => explainSynergies({ schedule: results.synergies, isBank: bankMode })} />
            </h3>
            {!forPdf && [
              { label: 'Year 1', value: results.synergiesY1, entered: results.synergies.years[0].entered },
              { label: 'Year 2', value: results.synergiesY2, entered: results.synergies.years[1].entered },
              { label: 'Year 3', value: results.synergiesY3, entered: results.synergies.years[2].entered },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 50, fontSize: 12, color: '#6B7280' }}>{s.label}</div>
                <div style={{ flex: 1, background: '#F3F4F6', borderRadius: 4, height: 8 }}>
                  <div style={{ width: results.synergiesY3 > 0 ? `${(s.value / results.synergiesY3) * 100}%` : '0%', background: '#0F2244', height: 8, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 'bold' }}>{s.entered ? fmtSynergy(s.value) : NONE_ENTERED}</div>
              </div>
            ))}
            <SynergyLines deal={deal} style={{ marginTop: 10 }} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ color: '#0F2244', marginTop: 0 }}>Pro Forma Income Statement</h3>
            {vYear && !bankMode && (
              <div data-testid="pf-year-note" style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 8, fontStyle: 'italic' }}>
                Net income to EPS: <strong style={{ color: '#374151', fontStyle: 'normal' }}>{hEps.label}</strong>. {vYearNote} Revenue and EBITDA are Year 1 figures.
              </div>
            )}
            {(bankMode ? [
              { label: 'Combined Net Interest Income',  value: fmtMoneyTable((target?.netInterestIncome || 0) + (acquirer?.netInterestIncome || 0)) },
              { label: 'Combined Non-Interest Income',  value: fmtMoneyTable((target?.nonInterestIncome || 0) + (acquirer?.nonInterestIncome || 0)) },
              { label: 'Combined Non-Interest Expense', value: `(${fmtMoneyTable((target?.nonInterestExpense || 0) + (acquirer?.nonInterestExpense || 0))})`, red: true },
              { label: (inputs.companyANetIncomeToCommon ? 'Acquirer Net Income to Common (EPS numerator)' : 'Acquirer Net Income'), value: fmtMoneyAccounting(inputs.companyANetIncome) },
              { label: (inputs.companyBNetIncomeToCommon ? 'Target Net Income to Common (EPS numerator)' : 'Target Net Income'), value: fmtMoneyAccounting(inputs.companyBNetIncome) },
              { label: 'After-Tax Cost Synergies (Y1)', value: synergyY1Entered ? `+${fmtMoneyTable(results.afterTaxSynergies)}` : NONE_ENTERED, green: synergyY1Entered },
              ...(results.newInterestAfterTax == null ? [{ label: 'After-Tax Financing Cost', value: '—' }]   // unknown (target debt unavailable) — shown, not dropped
                : parseFloat(results.newInterestAfterTax) > 0 ? [{ label: 'After-Tax Financing Cost', value: `(${fmtInterest(results.newInterestAfterTax)})`, red: true }] : []),
              ...lostInterestRows,
              { label: 'Pro Forma Net Income',          value: fmtMoneyAccounting(results.proFormaNetIncome), bold: true },
              { label: 'Pro Forma EPS',                 value: fmtPerShare(results.proFormaEPS), bold: true, green: results.isAccretive, explain: () => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA }) },
            ] : [
              { label: 'Combined Revenue',    value: results.basesDiffer ? '—' : fmtMoneyTable(results.combinedRevenue)                          },
              ...(results.synergies.years[0].revenue != null ? [{ label: 'Pro Forma Revenue (incl. Y1 revenue synergies)', value: fmtMoneyTable(results.proFormaRevenue) }] : []),
              { label: ngPlan ? `Combined EBITDA (${combinedEbitdaBasis || 'n/a'}${ebSources ? `: ${ebSources}` : ''}, incl. Y1 synergies)` : 'Combined EBITDA (incl. Y1 synergies)',
                value: results.basesDiffer ? '—' : ebDiffer ? `— (${DIFFERENT_BASES})` : fmtMoneyTable(results.combinedEBITDA) },
              ...(vYear ? [
                // Fix 16 Task 3: the verdict's forecast year — consensus EPS × today's diluted shares (dealCalc.forwardYearInputs).
                { label: `Acquirer Net Income (${vYear.year} consensus EPS × diluted shares)`, value: vYearPF ? fmtMoneyAccounting(vYearPF.acquirerNetIncome) : '—' },
                { label: `Target Net Income (${vYear.year} consensus EPS × diluted shares)`, value: vYearPF ? fmtMoneyAccounting(vYearPF.targetNetIncome) : '—' },
                { label: `After-Tax Synergies (${vYear.year})`, value: !synergyY1Entered ? NONE_ENTERED : vYearPF ? `+${fmtMoneyTable(vYearPF.afterTaxSynergies)}` : '—', green: synergyY1Entered, explain: () => explainSynergies({ schedule: results.synergies, isBank: false }) },
              ] : [
              { label: ngPlan && ngPlan.eps.nonGaap ? (ngPlan.eps.A?.computed ? 'Acquirer Net Income (non-GAAP, computed)' : 'Acquirer Net Income (non-GAAP)') : (inputs.companyANetIncomeToCommon ? 'Acquirer Net Income to Common (EPS numerator)' : 'Acquirer Net Income'), value: fmtMoneyAccounting(inputs.companyANetIncome) },
              { label: ngPlan && ngPlan.eps.nonGaap ? (ngPlan.eps.B?.computed ? 'Target Net Income (non-GAAP, computed)' : 'Target Net Income (non-GAAP)') : (inputs.companyBNetIncomeToCommon ? 'Target Net Income to Common (EPS numerator)' : 'Target Net Income'),   value: fmtMoneyAccounting(inputs.companyBNetIncome) },
              { label: 'After-Tax Synergies (Y1)',  value: synergyY1Entered ? `+${fmtMoneyTable(results.afterTaxSynergies)}` : NONE_ENTERED, green: synergyY1Entered, explain: () => explainSynergies({ schedule: results.synergies, isBank: false }) },
              ]),
              ...(results.newInterestAfterTax == null ? [{ label: 'After-Tax Financing Cost', value: '—' }]   // unknown (target debt unavailable) — shown, not dropped
                : parseFloat(results.newInterestAfterTax) > 0 ? [{ label: 'After-Tax Financing Cost', value: `(${fmtInterest(results.newInterestAfterTax)})`, red: true }] : []),
              ...lostInterestRows,
              { label: vYear ? `Pro Forma Net Income (${vYear.year})` : 'Pro Forma Net Income', value: y1Blocked ? '—' : vYear ? (vYearPF ? fmtMoneyAccounting(vYearPF.netIncome) : '—') : fmtMoneyAccounting(results.proFormaNetIncome), bold: true },
              { label: vYear ? `Pro Forma EPS (${vYear.year})` : 'Pro Forma EPS', value: y1Blocked ? '—' : vYear ? (vYearPF ? fmtPerShare(vYearPF.eps) : '—') : fmtPerShare(results.proFormaEPS), bold: true, green: vYear ? hEps.verdict === 'accretive' : results.isAccretive, explain: () => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA }) },
            ]).map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: rowPad, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: rowFont, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {row.label}
                  {row.explain && <ExplainButton explain={row.explain} />}
                </span>
                <span style={{ fontSize: rowFont, fontWeight: row.bold ? 'bold' : 'normal', color: row.green ? '#16A34A' : row.red ? '#DC2626' : '#111827' }}>{row.value}</span>
              </div>
            ))}
            <h3 style={{ color: '#0F2244' }}>Deal Structure</h3>
            {[
              { label: 'Total Purchase Price', value: fmtMoneyDual(results.totalPurchasePrice), explain: () => explainDealSize({ offerPrice: inputs.offerPricePerShare, shares: inputs.companyBShares, targetName: nameB }) },
              { label: 'Cash Portion',         value: fmtMoneyTable(results.cashPortion), explain: () => explainCashPercent({ cashPercent: inputs.cashPercent, dealSize: results.totalPurchasePrice }) },
              { label: 'Stock Portion',        value: fmtMoneyTable(results.stockPortion)      },
              { label: 'New Shares Issued',    value: newSharesText                             },
              { label: 'Purchase Premium',     value: (() => {
                const pp = parseFloat(results.purchasePremium);
                return (!isFinite(pp) || Math.abs(pp) > 200) ? 'N/A' : `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}%`;
              })() },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: rowPad, borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: rowFont, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {row.label}
                  {row.explain && <ExplainButton explain={row.explain} />}
                </span>
                <span style={{ fontSize: rowFont, color: '#111827' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sensitivity Analysis */}
        <div style={{ ...cardStyle, marginBottom: mb }}>
          <h3 style={{ color: '#0F2244', marginTop: 0, marginBottom: 4 }}>Sensitivity Analysis</h3>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 16px', lineHeight: 1.6 }}>
            {vYear && <><strong style={{ color: '#374151' }}>{hEps.label}</strong>. {vYearNote}<br /></>}
            Pro forma EPS at varying premium levels (rows) and synergy realization (columns). 100% = {synergyY1Entered ? `${fmtSynergy(sSyn)} ${vYear ? `${vYear.year} synergies` : 'Year 1 total synergies'} as entered` : `${NONE_ENTERED}: no synergies assumed`}.<br />
            {breakevenEPS > 0 && <>Breakeven: <strong style={{ color: '#374151' }}>${breakevenEPS.toFixed(2)}</strong> (acquirer standalone EPS).<br /></>}
            {inputs.year1Reason && !vYear
              ? `Year 1 pro forma EPS is "—": ${inputs.year1Reason}.`
              : breakevenEPS > 0
              ? 'Cells above breakeven are accretive; below are dilutive.'
              : 'Cells shaded green sit above the current acquirer EPS (a smaller loss); accretion/(dilution) is not meaningful from a non-positive EPS base.'}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 460 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ padding: cellPad, textAlign: 'left', background: '#F9FAFB', borderBottom: '2px solid #E5E7EB', color: '#6B7280', fontWeight: 600, verticalAlign: 'bottom' }}>
                    Price \ Synergies
                  </th>
                  <th colSpan={5} style={{ padding: '6px 10px', textAlign: 'center', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#9CA3AF', fontWeight: 600, fontSize: 11, fontStyle: 'italic' }}>
                    Synergy realization vs. announced figure
                  </th>
                </tr>
                <tr>
                  {SYN_LABELS.map((l, j) => {
                    const subLabel = j === 0 ? '(Bear)' : j === 2 ? '(Base)' : j === 4 ? '(Bull)' : null;
                    return (
                      <th key={j} style={{ padding: '6px 10px', textAlign: 'center', background: j === 2 ? '#E8EFFE' : '#F9FAFB', borderBottom: '2px solid #E5E7EB', color: j === 2 ? '#0F2244' : '#6B7280', fontWeight: j === 2 ? 700 : 600 }}>
                        {l}
                        {subLabel && (
                          <span style={{ display: 'block', fontSize: 10, color: '#9CA3AF', fontStyle: 'italic', fontWeight: 400 }}>
                            {subLabel}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rowPremiums.map((prem, i) => {
                  const isCurRow = i === sensitivityCurrentRow && havePremium;
                  const offerPriceAtRow = rowOfferPrices[i];
                  return (
                  <tr key={i}>
                    <td style={{ padding: cellPad, background: isCurRow ? '#E8EFFE' : '#F9FAFB', borderBottom: '1px solid #F3F4F6', color: isCurRow ? '#0F2244' : '#6B7280', fontWeight: isCurRow ? 700 : 400 }}>
                      <span>{prem}% premium</span>
                      <span style={{ fontSize: 10, display: 'block', color: '#9CA3AF' }}>
                        {offerPriceAtRow > 0 ? `$${offerPriceAtRow.toFixed(2)}/share` : '— (no share price)'}
                      </span>
                    </td>
                    {SYN_MULTS.map((_, j) => {
                      const eps = sensitivityData?.[i]?.[j];
                      const isCurrent = i === sensitivityCurrentRow && j === 2 && havePremium;
                      const breakeven = breakevenEPS;
                      const delta = (eps !== null && breakeven > 0) ? (eps - breakeven) / breakeven : 0;
                      const side = epsVsBreakeven(eps, breakeven);   // Fix 17 Task 5: green above the stated breakeven, red below
                      let bg, color;
                      if (eps === null) { bg = '#F9FAFB'; color = '#9CA3AF'; }
                      else if (side === 'below') { if (delta <= -0.10) { bg = '#DC2626'; color = '#fff'; } else { bg = '#FCA5A5'; color = '#7F1D1D'; } }
                      else if (side === 'above') { if (delta >= 0.10) { bg = '#10B981'; color = '#fff'; } else { bg = '#86EFAC'; color = '#14532D'; } }
                      else { bg = '#F3F4F6'; color = '#374151'; }
                      return (
                        <td key={j} style={{ padding: cellPad, textAlign: 'center', background: bg, borderBottom: '1px solid #F3F4F6', borderLeft: '1px solid #F3F4F6', color, fontWeight: isCurrent ? 700 : 500, position: 'relative', outline: isCurrent ? '2px solid #0F2244' : 'none', outlineOffset: isCurrent ? '-2px' : undefined }}>
                          {isCurrent && (
                            <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 9, fontWeight: 700, color: '#0F2244', letterSpacing: 0.3 }}>
                              Current
                            </span>
                          )}
                          {eps === null ? (y1Blocked ? '—' : 'N/A') : fmtPerShare(eps)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
          {sensitivityFooter && (
            <p style={{ fontSize: 11, color: '#6B7280', margin: '10px 0 0', fontStyle: 'italic', lineHeight: 1.5 }}>
              {sensitivityFooter}
            </p>
          )}
        </div>

        {/* Cash Structure Sensitivity Strip */}
        <div style={{ ...cardStyle, marginBottom: mb }}>
          <h3 style={{ color: '#0F2244', marginTop: 0, marginBottom: 4 }}>Cash Structure Sensitivity</h3>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 12px' }}>
            {vYear && <><strong style={{ color: '#374151' }}>{hEps.label}</strong>. {vYearNote} </>}Pro Forma EPS at different cash/stock splits (offer price and synergies held constant). {inputs.year1Reason && !vYear ? `Year 1 pro forma EPS is "—": ${inputs.year1Reason}.` : <>Green = {breakevenEPS > 0 ? 'accretive vs. current acquirer EPS.' : 'above (better than) the current acquirer EPS; accretion/(dilution) is not meaningful from a non-positive base.'}</>}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {cashSensitivity.map(({ cashPct, eps }) => {
              const isCurrent = cashPct === inputs.cashPercent;
              // Fix 17 Task 5: the same comparison as the grid, against the same stated breakeven EPS.
              const side = breakevenEPS > 0 ? epsVsBreakeven(eps, breakevenEPS) : (eps !== null && eps > breakevenEPS ? 'above' : 'below');
              const at = side === 'at', acc = side === 'above';
              const bg    = isCurrent ? '#0F2244' : eps === null ? '#F9FAFB' : at ? '#F3F4F6' : acc ? '#F0FDF4' : '#FEF2F2';
              const color = isCurrent ? '#fff'    : eps === null ? '#9CA3AF' : at ? '#374151' : acc ? '#166534' : '#991B1B';
              return (
                <div key={cashPct} style={{ background: bg, borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: `1px solid ${isCurrent ? '#0F2244' : '#E5E7EB'}` }}>
                  <div style={{ fontSize: 11, color: isCurrent ? '#A8C4DC' : '#6B7280', marginBottom: 4 }}>
                    {cashPct}% cash
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color }}>
                    {eps === null ? (y1Blocked ? '—' : 'N/A') : fmtPerShare(eps)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Source Verification */}
        {verifiedTarget && !forPdf && (() => {
          const f = verifiedTarget.fields;
          const VERIFIED_ROWS = [
            { label: 'Revenue',          key: 'revenue' },
            { label: 'Net Income',       key: 'netIncome' },
            { label: 'Shares Out.',      key: 'sharesOutstanding' },
            { label: 'Cash & Equivalents', key: 'cash' },
            { label: 'Total Debt',       key: 'totalDebt' },
            { label: 'Free Cash Flow (CFO − capex)', key: 'freeCashFlow' },
            { label: 'Price',            key: 'price' },
            { label: 'Analyst Target',   key: 'analystTargetMean' },
          ];
          const counts = { verified: 0, flagged: 0, single: 0, missing: 0 };
          VERIFIED_ROWS.forEach(r => { if (f[r.key]) counts[f[r.key].status]++; });
          const allGood = counts.flagged === 0 && counts.missing === 0;

          return (
            <div style={{ ...cardStyle, marginBottom: mb }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ color: '#0F2244', margin: 0, fontSize: 15 }}>Source Verification — {target?.ticker}{target?.basis === 'ltm' ? ' (fiscal-year figures; shares at the latest cover)' : ''}</h3>
                <span style={{ fontSize: 11, color: allGood ? '#16A34A' : '#B45309', fontWeight: 600 }}>
                  {counts.verified} verified · {counts.single} single · {counts.flagged} flagged
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                {VERIFIED_ROWS.map(({ label, key }) => {
                  const fd = f[key];
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#F9FAFB', borderRadius: 6, fontSize: 12 }}>
                      <StatusDot status={fd?.status ?? 'missing'} />
                      <span style={{ color: '#374151', minWidth: 90 }}>{label}</span>
                      <VerifiedValue fieldResult={fd} compact />
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 10, color: '#9CA3AF', margin: '8px 0 0' }}>
                ✓ verified = 2+ sources agree · – single source · ⚠ flagged = sources disagree · hover for detail
              </p>
            </div>
          );
        })()}

        {/* Risk Flags */}
        <div style={{ ...cardStyle, marginBottom: mb }}>
          <h3 style={{ color: '#0F2244', marginTop: 0, marginBottom: 12 }}>Risk Flags</h3>
          {allFlags.length === 0 ? (
            <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <span style={{ fontSize: 13, color: '#166534', fontWeight: 500 }}>No major flags — deal looks structurally sound</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allFlags.map((f, i) => (
                <div key={i} style={{ background: f.level === 'critical' ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${f.level === 'critical' ? '#FECACA' : '#FDE68A'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{f.icon}</span>
                  <span style={{ fontSize: 13, color: f.level === 'critical' ? '#991B1B' : '#92400E', fontWeight: 500 }}>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
  // Fix 16 Task 8: in the deck PDF the Deal Summary is a slide with the same header and footer as every other page.
  if (forPdf) {
    return (
      <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
        <PageHeader title="Deal Summary" subtitle={`${[acquirer?.ticker || acquirer?.name || nameA, target?.ticker || target?.name || nameB].filter(Boolean).join(' / ') || 'Transaction'} · verdict, EPS impact, pro forma and sensitivity`} />
        <style>{PDF_DASH_CSS}</style>
        <div data-pdf-dash="" style={{ padding: '8px 18px 36px', fontFamily: 'Arial, sans-serif' }}>{body}</div>
      </PageFrame>
    );
  }
  return (
    <div style={{ width: '100%', maxWidth: 1100, fontFamily: 'Arial, sans-serif' }}>
      {body}

      {/* Action buttons — screen only (Fix 14 Task 7: the deck PDF prints this page without them) */}
      {!forPdf && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, marginBottom: 32 }}>
        <button onClick={onEditInputs} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#fff', color: '#0F2244', border: '2px solid #0F2244', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
          ← Edit Inputs
        </button>
        <button onClick={onNewAnalysis} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#0F2244', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
          ↺ New Analysis
        </button>
        <button onClick={handleExportPDF} disabled={pdfLoading} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#1D4A8A', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: pdfLoading ? 'wait' : 'pointer', opacity: pdfLoading ? 0.7 : 1 }}>
          {pdfLoading ? '⟳ Generating…' : '⬇ Export Deal Summary PDF'}
        </button>
        {onSaveAnalysis && (
          <button onClick={onSaveAnalysis} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#fff', color: '#1D4A8A', border: '2px solid #1D4A8A', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
            💾 Save Analysis
          </button>
        )}
      </div>}
    </div>
  );
}
