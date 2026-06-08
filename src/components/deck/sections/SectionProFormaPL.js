import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtMoneyAccounting, fmtPerShare, fmtPctSigned } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';
import { calcProFormaEPS, acquirerStandaloneEPS } from '../../../utils/dealCalc';

// Cost synergies = 55% of total; revenue synergies = 45%
const COST_SYN_PCT = 0.55;
const REV_SYN_PCT  = 0.45;

// Only `revenue`/`netIncome` are fetched (EDGAR); synergies, fees and cash% are assumptions.
const USED_FIELDS = ['revenue', 'netIncome', 'synergiesY1', 'transactionFees', 'cashPercent'];


export function SectionProFormaPL({ target, acquirer, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const aRev  = parseFloat(acquirer.revenue)   || 0;
  const bRev  = parseFloat(target.revenue)     || 0;
  const aGP   = aRev * 0.65;
  const bGP   = bRev * 0.65;
  const aEBITDA = parseFloat(acquirer.ebitda)  || 0;
  const bEBITDA = parseFloat(target.ebitda)    || 0;
  const aOpex = aGP - aEBITDA;
  const bOpex = bGP - bEBITDA;

  const y1    = parseFloat(deal.synergiesY1) || 0;
  const y3    = parseFloat(deal.synergiesY3) || 0;
  const costSyn   = y1 * COST_SYN_PCT;
  const revSyn    = y1 * REV_SYN_PCT;
  const fees      = parseFloat(deal.transactionFees) || 0;
  const dealSize  = parseFloat(deal.totalPrice) || 0;
  const integCost = dealSize * 0.03;

  const totalStandaloneRev  = aRev + bRev;
  const pfRevenue    = totalStandaloneRev + revSyn;
  const totalStandaloneGP   = aGP + bGP;
  const pfGrossProfit = totalStandaloneGP + costSyn;
  const totalOpex    = aOpex + bOpex;
  const pfOpex       = totalOpex - costSyn;
  const pfOpIncome   = pfGrossProfit - pfOpex;
  const pfAdj        = pfOpIncome - integCost - fees;

  const pfRevPct = aRev > 0 ? ((pfRevenue - aRev) / aRev * 100) : 0;

  // Commentary
  const bullets = [
    `Pro forma revenue increases ~${pfRevPct.toFixed(0)}% versus standalone ${acquirer.name || 'acquirer'}.`,
    `Synergies of ${fmtMoneyTable(y1)} in Year 1, ramping to ${fmtMoneyTable(y3)} in Year 3.`,
    `Integration and transaction costs of ${fmtMoneyTable(integCost + fees)} expected one-time in Year 1.`,
    parseFloat(deal.epsAccretion) < 0
      ? `Deal is dilutive in Year 1; synergy realization drives accretion by Year 2/3.`
      : `Deal is accretive in Year 1 before full synergy realization.`,
    `Cost synergies (${fmtMoneyTable(costSyn)}) support gross margin expansion; revenue synergies (${fmtMoneyTable(revSyn)}) add incremental top-line.`,
  ];

  // ── Accretion / dilution table — tied to the corrected model (Phase 1.A), reactive to inputs ──
  const inputs = deal._inputs || {};
  const standaloneEPS = parseFloat(deal._results?.companyAEPS) || parseFloat(inputs.companyAEPS) || 0;
  const offer = parseFloat(deal.offerPrice) || parseFloat(inputs.offerPricePerShare) || 0;
  const accretionRows = [
    { year: 'Year 1', syn: parseFloat(deal.synergiesY1) || 0 },
    { year: 'Year 2', syn: parseFloat(deal.synergiesY2) || 0 },
    { year: 'Year 3', syn: parseFloat(deal.synergiesY3) || 0 },
  ].map(r => {
    const pf = calcProFormaEPS(offer, r.syn, inputs);
    const pct = (pf != null && standaloneEPS > 0) ? (pf / standaloneEPS - 1) * 100 : null;
    return { ...r, pfEPS: pf, pct, accretive: pf != null ? pf > standaloneEPS : null };
  });

  // ── DIAGNOSTIC (Fix 7): the §7 table divides by the 2-dp-rounded standalone EPS, so its Year-1 %
  //    diverges from the dashboard's epsChangePct (computed from the full-precision standalone EPS) ──
  {
    const exactBase = acquirerStandaloneEPS(inputs);
    const y1pf = calcProFormaEPS(offer, parseFloat(deal.synergiesY1) || 0, inputs);
    const roundedPct = (y1pf != null && standaloneEPS > 0) ? ((y1pf / standaloneEPS - 1) * 100).toFixed(1) : 'n/a';
    const exactPct   = (y1pf != null && exactBase > 0)     ? ((y1pf / exactBase - 1) * 100).toFixed(1)     : 'n/a';
    console.log(`[§7 EPS%] dashboard=${deal._results?.epsChangePct}% | §7 rounded-denom=${roundedPct}% (denom=${standaloneEPS}) | exact-denom=${exactPct}% (denom=${exactBase.toFixed(4)})`);
  }

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit F">
      <PageHeader
        title="Pro Forma P&L — Combined Entity"
        subtitle={`${acquirer.name || 'Acquirer'} + ${target.name || 'Target'} · Year 1 Pro Forma + 3-Year Accretion/(Dilution)`}
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: P&L table */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Pro Forma Income Statement ($M) — Year 1
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
              <span style={{ flex: 2, color: '#fff', fontSize: 10, fontWeight: 700 }}>Line Item</span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{acquirer.ticker || acquirer.name || 'Acquirer'}</span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{target.ticker || target.name || 'Target'}</span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Pro Forma</span>
            </div>

            {/* Revenue block */}
            {[
              { label: 'Standalone Revenue', a: fmtMoneyTable(aRev), b: fmtMoneyTable(bRev), pf: fmtMoneyTable(totalStandaloneRev) },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', padding: '5px 10px', background: i % 2 === 0 ? '#fff' : ALT_ROW, borderBottom: `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2, fontSize: 11, color: '#374151' }}>{row.label}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{row.a}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{row.b}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: NAVY }}>{row.pf}</span>
              </div>
            ))}

            <div style={{ display: 'flex', padding: '5px 10px', background: ALT_ROW, borderBottom: `1px solid ${GRAY_BORDER}`, paddingLeft: 22 }}>
              <span style={{ flex: 2, fontSize: 11, color: '#166534' }}>Plus: Revenue Synergies (Y1)</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#166534', fontWeight: 600 }}>+{fmtMoneyTable(revSyn)}</span>
            </div>
            <div style={{ display: 'flex', padding: '6px 10px', background: '#EFF6FF', borderBottom: `2px solid #0070D2` }}>
              <span style={{ flex: 2, fontSize: 11, fontWeight: 700, color: NAVY }}>Pro Forma Revenue</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 12, textAlign: 'right', fontWeight: 700, color: NAVY }}>{fmtMoneyTable(pfRevenue)}</span>
            </div>

            {/* Gross Profit block */}
            <div style={{ display: 'flex', padding: '5px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, background: '#fff' }}>
              <span style={{ flex: 2, fontSize: 11, color: '#374151' }}>Standalone Gross Profit (est.)</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtMoneyTable(aGP)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtMoneyTable(bGP)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: NAVY }}>{fmtMoneyTable(totalStandaloneGP)}</span>
            </div>
            <div style={{ display: 'flex', padding: '5px 10px', background: ALT_ROW, borderBottom: `1px solid ${GRAY_BORDER}`, paddingLeft: 22 }}>
              <span style={{ flex: 2, fontSize: 11, color: '#166534' }}>Plus: Cost Synergies (Y1)</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#166534', fontWeight: 600 }}>+{fmtMoneyTable(costSyn)}</span>
            </div>
            <div style={{ display: 'flex', padding: '6px 10px', background: '#EFF6FF', borderBottom: `2px solid #0070D2` }}>
              <span style={{ flex: 2, fontSize: 11, fontWeight: 700, color: NAVY }}>Pro Forma Gross Profit</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 12, textAlign: 'right', fontWeight: 700, color: NAVY }}>{fmtMoneyTable(pfGrossProfit)}</span>
            </div>

            {/* Opex block */}
            <div style={{ display: 'flex', padding: '5px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, background: '#fff' }}>
              <span style={{ flex: 2, fontSize: 11, color: '#374151' }}>Standalone Operating Expenses (est.)</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtMoneyAccounting(-aOpex)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtMoneyAccounting(-bOpex)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtMoneyAccounting(-totalOpex)}</span>
            </div>
            <div style={{ display: 'flex', padding: '5px 10px', background: ALT_ROW, borderBottom: `1px solid ${GRAY_BORDER}`, paddingLeft: 22 }}>
              <span style={{ flex: 2, fontSize: 11, color: '#166534' }}>Less: Cost Synergies</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#166534', fontWeight: 600 }}>{fmtMoneyAccounting(-costSyn)}</span>
            </div>
            <div style={{ display: 'flex', padding: '6px 10px', background: '#EFF6FF', borderBottom: `2px solid #0070D2` }}>
              <span style={{ flex: 2, fontSize: 11, fontWeight: 700, color: NAVY }}>Pro Forma Operating Profit</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 12, textAlign: 'right', fontWeight: 700, color: NAVY }}>{fmtMoneyTable(pfOpIncome)}</span>
            </div>

            {/* Adjustments */}
            <div style={{ display: 'flex', padding: '5px 10px', background: '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, paddingLeft: 22 }}>
              <span style={{ flex: 2, fontSize: 11, color: '#DC2626' }}>Less: Integration Costs (est. 3% of deal)</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#DC2626', fontWeight: 600 }}>{fmtMoneyAccounting(-integCost)}</span>
            </div>
            <div style={{ display: 'flex', padding: '5px 10px', background: ALT_ROW, borderBottom: `1px solid ${GRAY_BORDER}`, paddingLeft: 22 }}>
              <span style={{ flex: 2, fontSize: 11, color: '#DC2626' }}>Less: Transaction Fees</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#DC2626', fontWeight: 600 }}>{fmtMoneyAccounting(-fees)}</span>
            </div>
            <div style={{ display: 'flex', padding: '8px 10px', background: '#0F2244', borderTop: '2px solid #0070D2' }}>
              <span style={{ flex: 2, fontSize: 12, fontWeight: 700, color: '#fff' }}>PF Adjusted Operating Profit</span>
              <span style={{ flex: 1 }} /><span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 13, textAlign: 'right', fontWeight: 700, color: '#4ADE80' }}>{fmtMoneyTable(pfAdj)}</span>
            </div>
          </div>
        </div>

        {/* Right: commentary */}
        <div style={{ flex: '0 0 215px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Commentary
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Pro Forma Highlights</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              {bullets.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#0070D2', fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
                  <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Synergy mix callout */}
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Synergy Mix (Y1)
            </div>
            {[
              { label: 'Cost Synergies', val: costSyn, pct: COST_SYN_PCT * 100 },
              { label: 'Revenue Synergies', val: revSyn, pct: REV_SYN_PCT * 100 },
            ].map(item => (
              <div key={item.label} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: '#374151' }}>{item.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>
                    {fmtMoneyTable(item.val)} ({Math.round(item.pct)}%)
                  </span>
                </div>
                <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
                  <div style={{ height: 8, borderRadius: 4, background: '#0070D2', width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Accretion / Dilution table — recomputes live from the corrected model */}
      <div style={{ padding: '0 20px 8px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Accretion / (Dilution) Analysis — Pro Forma EPS vs. {acquirer.ticker || acquirer.name || 'Acquirer'} Standalone
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
            <span style={{ flex: 1.4, color: '#fff', fontSize: 10, fontWeight: 700 }}>Year (synergy run-rate)</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Acquirer EPS</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Pro Forma EPS</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Accretion/(Dilution)</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>Verdict</span>
          </div>
          {accretionRows.map((r, i) => (
            <div key={r.year} style={{ display: 'flex', padding: '6px 10px', background: i % 2 ? ALT_ROW : '#fff', borderBottom: `1px solid ${GRAY_BORDER}` }}>
              <span style={{ flex: 1.4, fontSize: 11, color: '#374151' }}>{r.year} <span style={{ color: '#9CA3AF' }}>({fmtMoneyTable(r.syn)})</span></span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{fmtPerShare(standaloneEPS)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: NAVY }}>{r.pfEPS == null ? 'N/A' : fmtPerShare(r.pfEPS)}</span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: r.accretive ? '#166534' : '#DC2626' }}>
                {r.pct == null ? 'N/M' : fmtPctSigned(r.pct)}
              </span>
              <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 700, color: r.accretive ? '#166534' : '#DC2626' }}>
                {r.accretive == null ? '—' : r.accretive ? 'Accretive' : 'Dilutive'}
              </span>
            </div>
          ))}
        </div>
        {standaloneEPS <= 0 && (
          <div style={{ fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', marginTop: 4 }}>
            Acquirer standalone EPS is ≤ 0 — percentage accretion is not meaningful (N/M); verdict shown by absolute EPS comparison.
          </div>
        )}
      </div>

      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
