import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtMoneyAccounting, fmtPct, fmtPerShare, buildFinancialCommentary, isFinancial } from '../shared/deckTokens';
import { efficiencyRatioLabel, cet1Label } from '../../../lib/bankCommentaryThresholds';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'cash', 'totalDebt', 'freeCashFlow'];

function buildBankCommentary(target, deal, { nii, nonIntInc, nonIntExp, bankTotalRev, bankNiMargin }) {
  const lines = [];
  if (deal.purchasePremium !== undefined)
    lines.push(`Acquisition premium of ${fmtPct(deal.purchasePremium)} versus estimated market value.`);

  const effRatio = (nonIntExp != null && bankTotalRev != null && bankTotalRev > 0)
    ? (nonIntExp / bankTotalRev * 100) : null;
  const effLabel = efficiencyRatioLabel(effRatio);
  if (effRatio != null && effLabel)
    lines.push(`Efficiency ratio of ${fmtPct(effRatio)} — ${effLabel}.`);

  const cet1Pct = target.cet1Ratio != null ? target.cet1Ratio * 100 : null;
  const cLabel  = cet1Label(cet1Pct);
  if (cet1Pct != null && cLabel)
    lines.push(`CET1 ratio of ${fmtPct(cet1Pct)} — ${cLabel}.`);

  lines.push(`Transaction financed ${fmtPct(deal.cashPercent)} cash / ${fmtPct(100 - parseFloat(deal.cashPercent || 0))} stock.`);
  return lines;
}

function PLRow({ label, value, alt, bold, indent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 10px', background: alt ? ALT_ROW : '#fff',
      borderBottom: `1px solid ${GRAY_BORDER}`,
      paddingLeft: indent ? 20 : 10,
    }}>
      <span style={{ fontSize: 11, color: bold ? NAVY : '#374151', fontWeight: bold ? 700 : 400 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, fontWeight: bold ? 700 : 500, color: bold ? NAVY : '#374151' }}>
        {value}
      </span>
    </div>
  );
}

// Thin wrappers so the deck can show a standalone P&L for EITHER side (reference §4 Acquirer,
// §5 Target). The acquirer instance hides deal-specific (premium / financing) commentary, which
// only makes sense for the target being acquired.
export function SectionStandalonePLTarget({ target, deal, pageNum }) {
  return <StandalonePLBody company={target} deal={deal} pageNum={pageNum} role="Target" showDealCommentary exhibitLabel="Exhibit B" />;
}
export function SectionStandalonePLAcquirer({ acquirer, pageNum }) {
  return <StandalonePLBody company={acquirer} deal={null} pageNum={pageNum} role="Acquirer" showDealCommentary={false} exhibitLabel="Exhibit B-2" />;
}
// Back-compat alias (original single-target usage).
export function SectionStandalonePL({ target, deal, pageNum }) {
  return <StandalonePLBody company={target} deal={deal} pageNum={pageNum} role="Target" showDealCommentary exhibitLabel="Exhibit B" />;
}

function StandalonePLBody({ company, deal, pageNum, role, showDealCommentary, exhibitLabel }) {
  const target = company; // body was written against `target`; keep the name internally
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const bankMode = isFinancial(target?.companyType);

  const rev    = parseFloat(target.revenue)   || 0;
  const ebitda = parseFloat(target.ebitda)    || 0;
  const ni     = parseFloat(target.netIncome) || 0;
  const cash   = parseFloat(target.cash)      || 0;
  const debt   = parseFloat(target.debt)      || 0;
  const shares = parseFloat(target.shares)    || 0;
  const eps    = parseFloat(target.eps)       || 0;

  const ebitdaMargin = rev > 0 && ebitda > 0 ? (ebitda / rev * 100) : 0;
  const niMargin     = rev > 0 && ni     > 0 ? (ni     / rev * 100) : 0;

  // Standard-mode estimates
  const estGrossProfit = rev * 0.65;
  const estOpex = ebitda > 0 ? (estGrossProfit - ebitda) : rev * 0.40;
  const estDA   = ebitda > 0 && ni > 0 && ni < ebitda ? (ebitda - ni) * 0.5 : ebitda * 0.15;
  const netDebt = debt - cash;

  // Bank-mode income statement values
  const nii       = target.netInterestIncome  != null ? parseFloat(target.netInterestIncome)  : null;
  const nonIntInc = target.nonInterestIncome  != null ? parseFloat(target.nonInterestIncome)  : null;
  const nonIntExp = target.nonInterestExpense != null ? parseFloat(target.nonInterestExpense) : null;
  const bankTotalRev = (nii != null && nonIntInc != null) ? nii + nonIntInc : (rev || null);
  const ppnr = (bankTotalRev != null && nonIntExp != null) ? bankTotalRev - nonIntExp : null;
  const provision = target.totalAssets != null ? parseFloat(target.totalAssets) * 0.003 : null;
  const bankNiMargin = bankTotalRev && bankTotalRev > 0 && ni > 0 ? (ni / bankTotalRev * 100) : niMargin;

  const fmtBankVal = (v) => v != null ? fmtMoneyTable(v) : 'N/A';
  const fmtBankNeg = (v) => v != null ? fmtMoneyAccounting(-v) : 'N/A';

  // Deal-dependent commentary (premium / financing) only belongs on the target side. The acquirer
  // standalone slide gets deal-free margin/scale commentary instead.
  const standaloneCommentary = (() => {
    const lines = [];
    if (rev > 0 && ebitda > 0) lines.push(`EBITDA margin of ${fmtPct(ebitda / rev * 100)} on ${fmtMoneyTable(rev)} of revenue.`);
    if (rev > 0 && ni > 0) lines.push(`Net income of ${fmtMoneyTable(ni)} — a ${fmtPct(ni / rev * 100)} net margin.`);
    if (rev > 0 && ni < 0) lines.push(`Reported a net loss of ${fmtMoneyTable(Math.abs(ni))} in the latest fiscal year — growth-stage profitability profile.`);
    if (shares > 0) lines.push(`${shares.toFixed(0)}M shares outstanding; GAAP EPS of ${fmtPerShare(eps)}.`);
    lines.push(`Net ${(debt - cash) < 0 ? 'cash' : 'debt'} position of ${fmtMoneyTable(Math.abs(debt - cash))}.`);
    return lines;
  })();
  const commentary = (showDealCommentary && deal) ? buildFinancialCommentary(target, deal) : standaloneCommentary;

  // Build an honest fiscal-year label from the server-supplied metadata.
  // CRM FY ends Jan → "FY2026 (ended Jan 2026)"; TEAM FY ends Jun → "FY2025 (ended Jun 2025)".
  const fyLabel = (() => {
    const fy  = target?.fiscalYear;
    const end = target?.fiscalYearEnd;
    if (!fy && !end) return 'Most Recent Annual Filing';
    if (!end) return `FY${fy}`;
    const endDate = new Date(end + 'T12:00:00Z');
    const month   = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `FY${fy} — Ended ${month}`;
  })();

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title={`Standalone P&L — ${role || 'Target'}: ${target.name || 'N/A'}`}
        subtitle={fyLabel}
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: P&L table */}
        <div style={{ flex: '0 0 380px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Income Statement Summary ($M)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Line Item</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>LTM ($M)</span>
            </div>
            {bankMode ? (
              <>
                <PLRow label="Net Interest Income"         value={fmtBankVal(nii)} />
                <PLRow label="Non-Interest Income"         value={fmtBankVal(nonIntInc)} alt />
                <PLRow label="Total Revenue"               value={fmtBankVal(bankTotalRev)} bold />
                <PLRow label="Non-Interest Expense"        value={fmtBankNeg(nonIntExp)} alt />
                <PLRow label="Pre-Provision Net Revenue"   value={fmtBankVal(ppnr)} bold />
                <PLRow label="Provision for Credit Losses" value={fmtBankNeg(provision)} alt />
                <PLRow label="Net Income"                  value={fmtMoneyTable(ni)} bold />
                <PLRow label="Net Margin"                  value={fmtPct(bankNiMargin)} indent alt />
                <PLRow label="EPS (Basic)"                 value={fmtPerShare(eps)} />
              </>
            ) : (
              <>
                <PLRow label="Revenue"                    value={fmtMoneyTable(rev)}            />
                <PLRow label="Gross Profit (est.)"        value={fmtMoneyTable(estGrossProfit)} alt indent />
                <PLRow label="Gross Margin (est.)"        value={fmtPct(65)}                    indent />
                <PLRow label="Operating Expenses (est.)"  value={fmtMoneyAccounting(-estOpex)}  alt indent />
                <PLRow label="EBITDA"                     value={fmtMoneyTable(ebitda)}         bold />
                <PLRow label="EBITDA Margin"              value={fmtPct(ebitdaMargin)}          indent alt />
                <PLRow label="D&A (est.)"                 value={fmtMoneyAccounting(-estDA)}    indent />
                <PLRow label="Net Income"                 value={fmtMoneyTable(ni)}             bold />
                <PLRow label="Net Margin"                 value={fmtPct(niMargin)}              indent alt />
                <PLRow label="EPS (Basic)"                value={fmtPerShare(eps)}     />
              </>
            )}
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Balance Sheet Highlights ($M)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: NAVY, padding: '5px 10px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Item</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Value ($M)</span>
            </div>
            {bankMode ? (
              <>
                <PLRow label="Total Assets"          value={fmtBankVal(target.totalAssets != null ? parseFloat(target.totalAssets) : null)} />
                <PLRow label="Total Loans"           value={fmtBankVal(target.totalLoans  != null ? parseFloat(target.totalLoans)  : null)} alt />
                <PLRow label="Total Deposits"        value={fmtBankVal(target.totalDeposits != null ? parseFloat(target.totalDeposits) : null)} />
                <PLRow label="Tangible Book Value"   value={fmtBankVal(target.tangibleBookValue != null ? parseFloat(target.tangibleBookValue) : null)} alt bold />
                <PLRow label="CET1 Ratio"            value={target.cet1Ratio != null ? fmtPct(target.cet1Ratio * 100) : 'N/A'} />
                <PLRow label="Shares Outstanding (M)" value={shares > 0 ? `${shares.toFixed(0)}M` : 'N/A'} alt />
              </>
            ) : (
              <>
                <PLRow label="Cash &amp; Equivalents" value={fmtMoneyTable(cash)} />
                <PLRow label="Total Debt"              value={fmtMoneyTable(debt)} alt />
                <PLRow label="Net Debt / (Cash)"       value={netDebt < 0 ? fmtMoneyAccounting(netDebt) : fmtMoneyTable(netDebt)} bold />
                <PLRow label="Shares Outstanding (M)"  value={shares > 0 ? `${shares.toFixed(0)}M` : 'N/A'} alt />
              </>
            )}
          </div>
        </div>

        {/* Right: commentary */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Commentary
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Financial Highlights</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              {(bankMode && showDealCommentary && deal ? buildBankCommentary(target, deal, { nii, nonIntInc, nonIntExp, bankTotalRev, bankNiMargin }) : commentary).map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#0070D2', fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
                  <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Metric Profile panel */}
          {bankMode ? (
            (() => {
              const effRatio = (nonIntExp != null && bankTotalRev != null && bankTotalRev > 0)
                ? (nonIntExp / bankTotalRev * 100) : null;
              const cet1Pct  = target.cet1Ratio != null ? target.cet1Ratio * 100 : null;
              const metrics  = [
                effRatio != null && { label: 'Efficiency Ratio', pct: effRatio, invertColor: true, note: 'lower is better' },
                bankNiMargin > 0 && { label: 'Net Margin', pct: bankNiMargin },
                cet1Pct != null && { label: 'CET1 Ratio', pct: cet1Pct, cap: 20 },
              ].filter(Boolean);
              if (!metrics.length) return null;
              return (
                <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Key Metrics
                  </div>
                  {metrics.map(m => {
                    const barPct = Math.min(Math.max(m.pct, 0), m.cap || 100);
                    const barColor = m.invertColor
                      ? (m.pct < 55 ? '#16A34A' : m.pct < 65 ? '#D97706' : '#DC2626')
                      : '#0070D2';
                    return (
                      <div key={m.label} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: '#374151' }}>{m.label}{m.note ? ` (${m.note})` : ''}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{fmtPct(m.pct)}</span>
                        </div>
                        <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
                          <div style={{ height: 8, borderRadius: 4, background: barColor, width: `${barPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            ebitdaMargin > 0 && (
              <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Margin Profile
                </div>
                {[
                  { label: 'Gross Margin (est.)', pct: 65 },
                  { label: 'EBITDA Margin', pct: ebitdaMargin },
                  { label: 'Net Margin', pct: niMargin },
                ].map(m => (
                  <div key={m.label} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: '#374151' }}>{m.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{fmtPct(m.pct)}</span>
                    </div>
                    <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
                      <div style={{ height: 8, borderRadius: 4, background: '#0070D2', width: `${Math.min(Math.max(m.pct, 0), 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
