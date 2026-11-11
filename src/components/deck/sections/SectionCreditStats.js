import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { SynergyLines } from '../shared/SynergyLines';
import { isNonGaapDeal, combinedEbitdaLabel } from '../../../lib/reportingBasis';

// Phase 8 — Pro-Forma Credit Statistics. Leverage & coverage — the credit view that replaces the
// market-based analysis (equity performance / analyst consensus / EPS accretion) for a private deal,
// where there is no share price or EPS. Every figure is null-honest: an unavailable input renders "—",
// never a fabricated number (matches the deck's Fix-A discipline).
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmtM = v => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString()}M)` : `$${Math.round(v).toLocaleString()}M`);
const fmtX = v => v == null ? '—' : `${v.toFixed(1)}×`;
const TAX = 0.21;   // mirrors dealCalc TAX_RATE — used only to gross the after-tax financing drag back to pre-tax interest

export function SectionCreditStats({ target, acquirer, deal, pageNum, exhibitLabel }) {
  const R = (deal && deal._results) || {};
  const combinedEBITDA = num(R.combinedEBITDA) ?? num(deal?.combinedEBITDA);
  const aDebt = num(acquirer?.debt), tDebt = num(target?.debt), newDebt = num(R.newDebt);
  const combinedDebt = (aDebt != null && tDebt != null) ? aDebt + tDebt + (newDebt || 0) : null;
  const aCash = num(acquirer?.cash), tCash = num(target?.cash);
  const combinedCash = (aCash != null && tCash != null) ? aCash + tCash : null;
  const netDebt = (combinedDebt != null && combinedCash != null) ? combinedDebt - combinedCash : null;
  const netDebtEBITDA   = (netDebt != null && combinedEBITDA > 0) ? netDebt / combinedEBITDA : null;
  const grossDebtEBITDA = (combinedDebt != null && combinedEBITDA > 0) ? combinedDebt / combinedEBITDA : null;
  const interestPreTax  = num(R.newInterestAfterTax) != null ? num(R.newInterestAfterTax) / (1 - TAX) : null;
  const coverage        = (combinedEBITDA != null && interestPreTax > 0) ? combinedEBITDA / interestPreTax : null;

  const ngEb = isNonGaapDeal(deal) ? combinedEbitdaLabel(deal.reportingBasis) : null;   // null on a GAAP deal
  const rows = [
    { label: ngEb ? `Combined EBITDA (${ngEb.basis || 'n/a'})` : 'Combined EBITDA', v: ngEb && ngEb.note ? `— (${ngEb.note})` : fmtM(combinedEBITDA) },
    { label: 'Combined total debt (incl. acquisition financing)', v: fmtM(combinedDebt) },
    { label: 'Combined cash', v: fmtM(combinedCash) },
    { label: 'Net debt', v: fmtM(netDebt), bold: true },
    { label: 'Gross debt / EBITDA', v: fmtX(grossDebtEBITDA) },
    { label: 'Net debt / EBITDA', v: fmtX(netDebtEBITDA), bold: true },
    { label: 'Pro-forma interest expense (pre-tax, on new debt)', v: fmtM(interestPreTax) },
    { label: 'Interest coverage (EBITDA / interest)', v: fmtX(coverage), bold: true },
  ];
  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader title="Pro-Forma Credit Statistics" subtitle="Leverage & coverage — the credit view in place of market-based analysis for a private deal" />
      <div style={{ padding: '14px 24px 24px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F3F4F6', background: r.bold ? '#EFF6FF' : (i % 2 ? '#FAFAFA' : '#fff') }}>
                <td style={{ padding: '7px 10px', color: r.bold ? '#0F2244' : '#374151', fontWeight: r.bold ? 700 : 400 }}>{r.label}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.bold ? '#0F2244' : '#374151', fontWeight: r.bold ? 700 : 400 }}>{r.v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <SynergyLines deal={deal} title="Synergies ($M). Combined EBITDA above includes Year 1 only" style={{ marginTop: 12 }} />
        <div style={{ marginTop: 12, fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          Combined total debt includes the acquisition financing (new debt raised for the cash consideration). Interest is grossed up from the after-tax financing drag at the deck's {Math.round(TAX * 100)}% tax rate. Any component that is unavailable renders “—”, never a fabricated figure.
        </div>
      </div>
    </PageFrame>
  );
}
