import { useState, useRef } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  computeFlags, computeDealScore, buildNarrative,
  calcProFormaEPS, PRICE_MULTS, PRICE_LABELS, SYN_MULTS, SYN_LABELS,
} from '../../../utils/dealCalc';
import { calcStockIssuancePct, triggers199Rule } from '../../../lib/dealMath';
import {
  isBankDeal, calcPTBV, combinedCET1, computeBankFlags, buildBankNarrative,
  fmtRatio, fmtPct, fmtMoneyTable, fmtMoneyDual, fmtPerShare, fmtPctSigned,
} from '../shared/deckTokens';
import { useWindowWidth } from '../../../hooks/useWindowWidth';
import { ExplainButton } from '../../shared/ExplainButton';
import {
  explainEvEbitda, explainPeRatio, explainDebtEbitda,
  explainPTBV, explainCombinedCET1,
  explainEpsChange, explainDealScore,
  explainDealSize, explainTransactionFees, explainSynergies,
  explainCashPercent,
} from '../../../lib/explanations';

// SectionDashboard does NOT use PageFrame — it keeps the original dashboard styling.
export function SectionDashboard({ target, acquirer, deal, onEditInputs, onNewAnalysis, onSaveAnalysis }) {
  const { _results: results, _inputs: inputs, _nameA: nameA, _nameB: nameB } = deal;
  const [pdfLoading, setPdfLoading] = useState(false);
  const pdfRef = useRef(null);
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;

  if (!results || !inputs) return null;

  const bankMode = isBankDeal(target, acquirer);
  const flags     = bankMode
    ? computeBankFlags(results, inputs, target, acquirer)
    : computeFlags(results, inputs);
  const dealScore  = computeDealScore(results, flags);
  const narrative  = bankMode
    ? buildBankNarrative(results, inputs, target, acquirer, nameA, nameB)
    : buildNarrative(results, inputs, nameA, nameB, flags);
  const scoreColor   = dealScore >= 7 ? '#16A34A' : dealScore >= 4 ? '#D97706' : '#DC2626';
  const scoreBg      = dealScore >= 7 ? '#DCFCE7'  : dealScore >= 4 ? '#FEF3C7' : '#FEE2E2';
  const cardStyle    = { background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #E5E7EB' };
  const col2         = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 24 };

  // Stock issuance risk flags
  const acquirerSharePx = inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA
    : (inputs.companyAEPS > 0 ? inputs.companyAEPS * 15 : 0);
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
  const allFlags = [...flags, ...stockFlags];

  // Enterprise value (for explainers)
  const ev = parseFloat(results.totalPurchasePrice) + (inputs.companyBDebt || 0) - (inputs.companyBCash || 0);
  const combinedDebtForExplain = (inputs.companyADebt || 0) + (inputs.companyBDebt || 0) + parseFloat(results.cashPortion || 0);

  // Cash sensitivity strip: pro forma EPS at 100/80/60/40/20% cash
  const cashSensitivity = [100, 80, 60, 40, 20].map(cp => ({
    cashPct: cp,
    eps: calcProFormaEPS(inputs.offerPricePerShare, inputs.synergiesY1, { ...inputs, cashPercent: cp }),
  }));

  // Synergy reference for sensitivity: user's Y1 value, or 2% of combined revenue if none entered
  const synSensBase = inputs.synergiesY1 > 0
    ? inputs.synergiesY1
    : Math.max(1, Math.round(0.02 * ((inputs.companyARevenue || 0) + (inputs.companyBRevenue || 0))));

  const sensitivityData = PRICE_MULTS.map(pm =>
    SYN_MULTS.map(sm => calcProFormaEPS(inputs.offerPricePerShare * pm, synSensBase * sm, inputs))
  );

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

  return (
    <div style={{ width: '100%', maxWidth: 1100, fontFamily: 'Arial, sans-serif' }}>
      <div ref={pdfRef}>
        {/* Verdict banner */}
        <div style={{ background: '#0F2244', borderRadius: 12, padding: 20, marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ color: '#A8C4DC', fontSize: 13 }}>Deal verdict</div>
            <div style={{ color: '#fff', fontSize: isMobile ? 22 : 28, fontWeight: 'bold' }}>
              {results.isAccretive ? '✓ Accretive' : '✗ Dilutive'}
            </div>
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
              <div style={{ color: results.isAccretive ? '#4ADE80' : '#F87171', fontSize: 22, fontWeight: 'bold' }}>
                {fmtPctSigned(parseFloat(results.epsChangePct))}
              </div>
            </div>
            <div style={{ background: scoreBg, borderRadius: 10, padding: '10px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                Deal Score
                <ExplainButton explain={() => explainDealScore({ score: dealScore, results })} />
              </div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: scoreColor }}>{dealScore}/10</div>
            </div>
          </div>
        </div>

        {/* Narrative */}
        <div style={{ ...cardStyle, marginBottom: 24, background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#1E3A5F', lineHeight: 1.7 }}>{narrative}</p>
        </div>

        {/* Key metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
          {(bankMode ? [
            {
              label: 'P / TBV',
              value: (() => {
                const v = calcPTBV(target);
                if (v != null) return fmtRatio(v);
                if (target?.tangibleBookValue) return 'Acquirer TBV missing';
                if (target?.marketCap) return 'Loading TBV…';
                return 'N/A';
              })(),
              explain: () => explainPTBV({ marketCap: target?.marketCap, tangibleBookValue: target?.tangibleBookValue, ratio: calcPTBV(target), companyName: nameB }),
            },
            {
              label: 'P / E Ratio',
              value: results.peRatio === 'N/A' ? 'N/A' : `${results.peRatio}x`,
              explain: () => explainPeRatio({ offerPrice: inputs.offerPricePerShare, eps: inputs.companyBEPS, multiple: results.peRatio }),
            },
            {
              label: 'CET1 (Combined)',
              value: (() => {
                const combined = combinedCET1(target, acquirer);
                if (combined != null) return fmtPct(combined * 100);
                const tC = target?.cet1Ratio;
                const aC = acquirer?.cet1Ratio;
                if (tC && !aC) return `Target: ${fmtPct(tC * 100)} · Acquirer: loading`;
                if (!tC && aC) return `Acquirer: ${fmtPct(aC * 100)} · Target: loading`;
                if (!tC && !aC && (target?.riskWeightedAssets || acquirer?.riskWeightedAssets))
                  return 'CET1 not in XBRL filing';
                return 'Loading…';
              })(),
              explain: () => explainCombinedCET1({ targetCET1: target?.cet1Ratio, acquirerCET1: acquirer?.cet1Ratio, targetRWA: target?.riskWeightedAssets, acquirerRWA: acquirer?.riskWeightedAssets }),
            },
          ] : [
            {
              label: 'EV / EBITDA',
              value: results.evEBITDA === 'N/A' ? 'N/A' : `${results.evEBITDA}x`,
              explain: () => explainEvEbitda({ ev, ebitda: inputs.companyBEBITDA, multiple: results.evEBITDA }),
            },
            {
              label: 'P / E Ratio',
              value: results.peRatio === 'N/A' ? 'N/A' : `${results.peRatio}x`,
              explain: () => explainPeRatio({ offerPrice: inputs.offerPricePerShare, eps: inputs.companyBEPS, multiple: results.peRatio }),
            },
            {
              label: 'Debt / EBITDA',
              value: results.debtEBITDA === 'N/A' ? 'N/A' : `${results.debtEBITDA}x`,
              explain: () => explainDebtEbitda({ combinedDebt: combinedDebtForExplain, combinedEbitda: results.combinedEBITDA, multiple: results.debtEBITDA }),
            },
          ]).map(m => (
            <div key={m.label} style={{ background: '#fff', borderRadius: 10, padding: 20, border: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {m.label}
                <ExplainButton explain={m.explain} />
              </div>
              <div style={{ fontSize: 28, fontWeight: 'bold', color: '#0F2244' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* EPS Analysis + Pro Forma */}
        <div style={col2}>
          <div style={cardStyle}>
            <h3 style={{ color: '#0F2244', marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              EPS Analysis
              <ExplainButton explain={() => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA })} />
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Before</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{fmtPerShare(results.companyAEPS)}</div>
              </div>
              <div style={{ fontSize: 24, color: '#6B7280', alignSelf: 'center' }}>→</div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>After</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: results.isAccretive ? '#16A34A' : '#DC2626' }}>
                  {fmtPerShare(results.proFormaEPS)}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Change</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: results.isAccretive ? '#16A34A' : '#DC2626' }}>
                  {fmtPctSigned(parseFloat(results.epsChangePct))}
                </div>
              </div>
            </div>
            <h3 style={{ color: '#0F2244', display: 'flex', alignItems: 'center', gap: 6 }}>
              {bankMode ? 'Cost Savings' : 'Synergies'}
              <ExplainButton explain={() => explainSynergies({ synY1: results.synergiesY1, synY2: results.synergiesY2, synY3: results.synergiesY3, combinedRevenue: results.combinedRevenue, isBank: bankMode, combinedNIE: (target?.nonInterestExpense || 0) + (acquirer?.nonInterestExpense || 0) })} />
            </h3>
            {[
              { label: 'Year 1', value: results.synergiesY1 },
              { label: 'Year 2', value: results.synergiesY2 },
              { label: 'Year 3', value: results.synergiesY3 },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 50, fontSize: 12, color: '#6B7280' }}>{s.label}</div>
                <div style={{ flex: 1, background: '#F3F4F6', borderRadius: 4, height: 8 }}>
                  <div style={{ width: results.synergiesY3 > 0 ? `${(s.value / results.synergiesY3) * 100}%` : '0%', background: '#0F2244', height: 8, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 'bold' }}>${s.value}M</div>
              </div>
            ))}
          </div>

          <div style={cardStyle}>
            <h3 style={{ color: '#0F2244', marginTop: 0 }}>Pro Forma Income Statement</h3>
            {(bankMode ? [
              { label: 'Combined Net Interest Income',  value: fmtMoneyTable((target?.netInterestIncome || 0) + (acquirer?.netInterestIncome || 0)) },
              { label: 'Combined Non-Interest Income',  value: fmtMoneyTable((target?.nonInterestIncome || 0) + (acquirer?.nonInterestIncome || 0)) },
              { label: 'Combined Non-Interest Expense', value: `(${fmtMoneyTable((target?.nonInterestExpense || 0) + (acquirer?.nonInterestExpense || 0))})`, red: true },
              { label: 'Year 1 Cost Synergies',         value: `+${fmtMoneyTable(results.synergiesY1)}`, green: true },
              { label: 'Transaction Fees',              value: `(${fmtMoneyTable(results.transactionFees)})`, red: true, explain: () => explainTransactionFees({ fees: results.transactionFees, dealSize: results.totalPurchasePrice }) },
              { label: 'Combined Net Income',           value: fmtMoneyTable(results.combinedNetIncome) },
              { label: 'Pro Forma EPS',                 value: fmtPerShare(results.proFormaEPS), bold: true, green: results.isAccretive, explain: () => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA }) },
            ] : [
              { label: 'Combined Revenue',    value: fmtMoneyTable(results.combinedRevenue)                          },
              { label: 'Combined EBITDA',     value: fmtMoneyTable(results.combinedEBITDA)                           },
              { label: 'Year 1 Synergies',    value: `+${fmtMoneyTable(results.synergiesY1)}`,   green: true, explain: () => explainSynergies({ synY1: results.synergiesY1, synY2: results.synergiesY2, synY3: results.synergiesY3, combinedRevenue: results.combinedRevenue, isBank: false }) },
              { label: 'Transaction Fees',    value: `(${fmtMoneyTable(results.transactionFees)})`, red: true, explain: () => explainTransactionFees({ fees: results.transactionFees, dealSize: results.totalPurchasePrice }) },
              { label: 'Combined Net Income', value: fmtMoneyTable(results.combinedNetIncome)                        },
              { label: 'Pro Forma EPS',       value: fmtPerShare(results.proFormaEPS),            bold: true, green: results.isAccretive, explain: () => explainEpsChange({ acquirerEPS: results.companyAEPS, proFormaEPS: results.proFormaEPS, changePct: results.epsChangePct, acquirerName: nameA }) },
            ]).map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 13, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {row.label}
                  {row.explain && <ExplainButton explain={row.explain} />}
                </span>
                <span style={{ fontSize: 13, fontWeight: row.bold ? 'bold' : 'normal', color: row.green ? '#16A34A' : row.red ? '#DC2626' : '#111827' }}>{row.value}</span>
              </div>
            ))}
            <h3 style={{ color: '#0F2244' }}>Deal Structure</h3>
            {[
              { label: 'Total Purchase Price', value: fmtMoneyDual(results.totalPurchasePrice), explain: () => explainDealSize({ offerPrice: inputs.offerPricePerShare, shares: inputs.companyBShares, targetName: nameB }) },
              { label: 'Cash Portion',         value: fmtMoneyTable(results.cashPortion), explain: () => explainCashPercent({ cashPercent: inputs.cashPercent, dealSize: results.totalPurchasePrice }) },
              { label: 'Stock Portion',        value: fmtMoneyTable(results.stockPortion)      },
              { label: 'New Shares Issued',    value: `${results.newSharesIssued}M`            },
              { label: 'Purchase Premium',     value: (() => {
                const pp = parseFloat(results.purchasePremium);
                return (!isFinite(pp) || Math.abs(pp) > 200) ? 'N/A' : `${pp >= 0 ? '+' : ''}${pp.toFixed(1)}%`;
              })() },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F3F4F6' }}>
                <span style={{ fontSize: 13, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {row.label}
                  {row.explain && <ExplainButton explain={row.explain} />}
                </span>
                <span style={{ fontSize: 13, color: '#111827' }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sensitivity Analysis */}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3 style={{ color: '#0F2244', marginTop: 0, marginBottom: 4 }}>Sensitivity Analysis</h3>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 16px' }}>
            Pro Forma EPS at different offer prices (rows) and Year 1 synergy levels (columns). Green = accretive, red = dilutive. Navy = current scenario.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 460 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 10px', textAlign: 'left', background: '#F9FAFB', borderBottom: '2px solid #E5E7EB', color: '#6B7280', fontWeight: 600 }}>
                    Price \ Synergies
                  </th>
                  {SYN_LABELS.map((l, j) => (
                    <th key={j} style={{ padding: '8px 10px', textAlign: 'center', background: j === 2 ? '#E8EFFE' : '#F9FAFB', borderBottom: '2px solid #E5E7EB', color: j === 2 ? '#0F2244' : '#6B7280', fontWeight: j === 2 ? 700 : 600 }}>
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PRICE_LABELS.map((pl, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px 10px', background: i === 2 ? '#E8EFFE' : '#F9FAFB', borderBottom: '1px solid #F3F4F6', color: i === 2 ? '#0F2244' : '#6B7280', fontWeight: i === 2 ? 700 : 400 }}>
                      {pl}
                      {i !== 2 && <span style={{ fontSize: 10, display: 'block', color: '#9CA3AF' }}>${(inputs.offerPricePerShare * PRICE_MULTS[i]).toFixed(2)}</span>}
                    </td>
                    {SYN_MULTS.map((_, j) => {
                      const eps = sensitivityData?.[i]?.[j];
                      const isCurrent = i === 2 && j === 2;
                      const acc = eps !== null && eps > inputs.companyAEPS;
                      const bg    = isCurrent ? '#0F2244' : eps === null ? '#F9FAFB' : acc ? '#F0FDF4' : '#FEF2F2';
                      const color = isCurrent ? '#fff'    : eps === null ? '#9CA3AF' : acc ? '#166534' : '#991B1B';
                      return (
                        <td key={j} style={{ padding: '8px 10px', textAlign: 'center', background: bg, borderBottom: '1px solid #F3F4F6', borderLeft: '1px solid #F3F4F6', color, fontWeight: isCurrent ? 700 : 500 }}>
                          {eps === null ? 'N/A' : fmtPerShare(eps)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cash Structure Sensitivity Strip */}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <h3 style={{ color: '#0F2244', marginTop: 0, marginBottom: 4 }}>Cash Structure Sensitivity</h3>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 12px' }}>
            Pro Forma EPS at different cash/stock splits (offer price and synergies held constant). Green = accretive vs. current acquirer EPS.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {cashSensitivity.map(({ cashPct, eps }) => {
              const isCurrent = cashPct === inputs.cashPercent;
              const acc = eps !== null && eps > inputs.companyAEPS;
              const bg    = isCurrent ? '#0F2244' : eps === null ? '#F9FAFB' : acc ? '#F0FDF4' : '#FEF2F2';
              const color = isCurrent ? '#fff'    : eps === null ? '#9CA3AF' : acc ? '#166534' : '#991B1B';
              return (
                <div key={cashPct} style={{ background: bg, borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: `1px solid ${isCurrent ? '#0F2244' : '#E5E7EB'}` }}>
                  <div style={{ fontSize: 11, color: isCurrent ? '#A8C4DC' : '#6B7280', marginBottom: 4 }}>
                    {cashPct}% cash
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color }}>
                    {eps === null ? 'N/A' : fmtPerShare(eps)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Risk Flags */}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
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

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, marginBottom: 32 }}>
        <button onClick={onEditInputs} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#fff', color: '#0F2244', border: '2px solid #0F2244', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
          ← Edit Inputs
        </button>
        <button onClick={onNewAnalysis} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#0F2244', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
          ↺ New Analysis
        </button>
        <button onClick={handleExportPDF} disabled={pdfLoading} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#1D4A8A', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: pdfLoading ? 'wait' : 'pointer', opacity: pdfLoading ? 0.7 : 1 }}>
          {pdfLoading ? '⟳ Generating…' : '⬇ Export Dashboard PDF'}
        </button>
        {onSaveAnalysis && (
          <button onClick={onSaveAnalysis} style={{ flex: '1 1 calc(50% - 5px)', minWidth: isMobile ? '100%' : 0, padding: '14px 16px', background: '#fff', color: '#1D4A8A', border: '2px solid #1D4A8A', borderRadius: 10, fontSize: 15, fontWeight: 'bold', cursor: 'pointer' }}>
            💾 Save Analysis
          </button>
        )}
      </div>
    </div>
  );
}
