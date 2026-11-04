import { useState } from 'react';
import { fmtMoneyTable } from '../deck/shared/deckTokens';

export const MIN_CASH_LABEL = 'Minimum cash kept by the combined company (% of pro forma revenue)';

const money = (v) => (v == null ? '—' : fmtMoneyTable(v));

function Row({ label, value, strong, testId }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 0', borderTop: strong ? '1.5px solid #0F2244' : '1px solid #EEF2F6' }}>
      <span style={{ color: strong ? '#0F2244' : '#6B7280', fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: strong ? 700 : 500, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

// Shows the deal model's own sources-of-funds result (dealCalc.acquisitionNewDebt). Displays it, computes nothing.
export function CashFundingBox({ funding, targetName }) {
  const [open, setOpen] = useState(false);
  const f = funding;
  const pct = f?.minCashPct != null ? `${(f.minCashPct * 100).toFixed(1)}%` : null;
  return (
    <div style={{ margin: '4px 0 10px' }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0 }}>
        ⓘ How the cash part gets paid
      </button>
      {open && (
        <div data-testid="cash-box" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 10px', marginTop: 6, fontSize: 12 }}>
          {f?.bank ? (
            <div style={{ color: '#6B7280', lineHeight: 1.4 }}>
              Bank deal: cash on hand is not used, so the whole cash part ({money(f.cashConsideration)}) is new debt.
            </div>
          ) : (
            <>
              <Row testId="cash-combined" label="Combined cash on hand" value={money(f?.combinedCash)} />
              <Row testId="cash-minimum" label={<>Less: {MIN_CASH_LABEL}{pct ? ` · ${pct}` : ''}</>} value={f?.minCash != null ? `(${money(f.minCash)})` : '—'} />
              <Row testId="cash-excess" label="Excess cash used" value={money(f?.excessCashUsed)} />
              <Row testId="cash-newdebt" label="New debt needed" value={money(f?.newDebt)} strong />
              {f?.newDebt != null && (
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 5, lineHeight: 1.4 }}>
                  New debt = cash part ({money(f.cashConsideration)}) + {targetName || 'target'} debt repaid ({money(f.targetDebtRepaid)}) − excess cash used ({money(f.excessCashUsed)}).
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
