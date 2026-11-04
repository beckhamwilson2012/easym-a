import { BASIS_FY, BASIS_LTM } from '../../lib/companyBasis';

// "Fiscal year | LTM" on a company card, with the period the card's figures cover beside it.
export function CompanyBasisToggle({ panel, basis, onChange, ltmAvailable, ltmReason, periodLabel }) {
  const seg = (value, label, disabled) => {
    const on = basis === value;
    return (
      <button type="button" data-testid={`basis-${panel}-${value}`} aria-pressed={on} disabled={disabled} onClick={() => onChange(value)}
        title={disabled ? ltmReason : undefined}
        style={{ padding: '3px 10px', fontSize: 12, fontWeight: on ? 700 : 500, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
          background: on ? '#0F2244' : (disabled ? '#F3F4F6' : '#fff'), color: on ? '#fff' : (disabled ? '#9CA3AF' : '#0F2244') }}>
        {label}
      </button>
    );
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid #D1D5DB', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {seg(BASIS_FY, 'Fiscal year', false)}
          {seg(BASIS_LTM, 'LTM', !ltmAvailable)}
        </div>
        {periodLabel && <span data-testid="revenue-period" style={{ fontSize: 12, color: '#374151' }}>{periodLabel}</span>}
      </div>
      {!ltmAvailable && ltmReason && <div data-testid={`basis-${panel}-reason`} style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 3 }}>LTM not available: {ltmReason}.</div>}
    </div>
  );
}
