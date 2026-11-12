import { GAAP, NON_GAAP } from '../../lib/reportingBasis';

// "GAAP | Non-GAAP" on the input page: the one reporting-basis switch (src/lib/reportingBasis.js decides what
// each choice means for each company). Non-GAAP is disabled, with the reason, when neither company reports a
// non-GAAP figure that ties to GAAP in its fiscal-year earnings release. While the lookups run, it waits.
export function ReportingBasisToggle({ value, availability, plan, onChange }) {
  const loading = availability.state === 'loading';
  const seg = (v, label, disabled, title) => {
    const on = value === v && !loading;
    return (
      <button type="button" data-testid={v === GAAP ? 'basis-toggle-gaap' : 'basis-toggle-nongaap'} aria-pressed={on} disabled={disabled}
        onClick={() => onChange(v)} title={title}
        style={{ padding: '4px 12px', fontSize: 12, fontWeight: on ? 700 : 500, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
          background: on ? '#0F2244' : (disabled ? '#F3F4F6' : '#fff'), color: on ? '#fff' : (disabled ? '#9CA3AF' : '#0F2244') }}>
        {label}
      </button>
    );
  };
  const nonGaapDisabled = loading || !availability.available;
  const notes = [];
  if (!loading && value === NON_GAAP && plan && plan.selected === NON_GAAP && plan.noChange) {
    notes.push(plan.noChange);   // the toggle still switches; this says why no figure moves
  } else if (!loading && value === NON_GAAP && plan && plan.selected === NON_GAAP) {
    notes.push(plan.eps.nonGaap ? 'EPS, pro forma EPS and accretion: non-GAAP (company reported, both companies).' : `EPS, pro forma EPS and accretion: ${plan.eps.note}.`);
    ['A', 'B'].forEach((P) => {
      const e = plan.ebitda[P];
      if (e.nonGaap) notes.push(`${P === 'A' ? 'Acquirer' : 'Target'} EBITDA: ${e.name} (non-GAAP, company reported)${e.note ? ` — ${e.note}` : ''}.`);
    });
    if (!plan.ebitda.combinable) notes.push('Combined EBITDA: — (companies on different bases).');
  }
  return (
    <div data-testid="basis-toggle" data-state={loading ? 'loading' : (availability.available ? 'available' : 'unavailable')} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Reporting basis</span>
        <div style={{ display: 'inline-flex', border: '1px solid #D1D5DB', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
          {seg(GAAP, 'GAAP', false)}
          {seg(NON_GAAP, 'Non-GAAP', nonGaapDisabled, nonGaapDisabled && !loading ? availability.reason : undefined)}
        </div>
        {loading && <span style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>Checking the earnings releases…</span>}
      </div>
      {!loading && !availability.available && (
        <div data-testid="basis-toggle-reason" style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 3 }}>Non-GAAP not available: {availability.reason}.</div>
      )}
      {notes.length > 0 && (
        <div data-testid="basis-toggle-notes" style={{ fontSize: 11, color: '#6B7280', marginTop: 4, lineHeight: 1.45 }}>
          {notes.map((n, i) => <div key={i}>{n}</div>)}
        </div>
      )}
    </div>
  );
}
