import { useEffect, useState } from 'react';
import { pnlFetch } from '../sections/SectionProFormaPL';
import { buildDeckModel } from '../../../lib/deckModel';
import { dealVerdict } from '../../../lib/dealVerdict';

// The verdict for Deal Summary and Executive Summary. Forecast columns come from the same cached /api/pnl fetch
// slide 8 reads, so the ladder's forward EPS test is slide 8's own row.
export function useDealVerdict({ deal, acquirer, target, model }) {
  const aTk = acquirer?.ticker || null, bTk = target?.ticker || null;
  const [pnl, setPnl] = useState({ a: null, b: null, loading: !!(aTk && bTk) });
  useEffect(() => {
    if (!aTk || !bTk) { setPnl({ a: null, b: null, loading: false }); return undefined; }
    let cancel = false;
    setPnl(p => ({ ...p, loading: true }));
    Promise.all([pnlFetch(aTk), pnlFetch(bTk)]).then(([a, b]) => { if (!cancel) setPnl({ a, b, loading: false }); });
    return () => { cancel = true; };
  }, [aTk, bTk]);
  const fwd = (p) => (p && Array.isArray(p.columns) ? p.columns.filter(c => !c.actual) : null);
  return dealVerdict({
    deal, model: model || buildDeckModel({ target, acquirer, deal }),
    acquirerFwd: fwd(pnl.a), targetFwd: fwd(pnl.b), fwdLoading: pnl.loading,
    acquirerName: aTk || acquirer?.name, targetName: bTk || target?.name,
  });
}

// One line plus the tag, and the breakeven line under it.
export function VerdictBlock({ verdict, dark, size = 28 }) {
  const color = verdict.verdict === 'accretive' || verdict.verdict === 'covers' ? (dark ? '#4ADE80' : '#15803D')
    : verdict.verdict === 'dilutive' || verdict.verdict === 'short' ? (dark ? '#F87171' : '#B91C1C')
    : (dark ? '#fff' : '#374151');
  return (
    <div data-testid="deal-verdict">
      <div data-testid="deal-verdict-text" style={{ color, fontSize: size, fontWeight: 'bold', lineHeight: 1.2 }}>{verdict.text}</div>
      {verdict.tag && (
        <div data-testid="deal-verdict-tag" style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, color: dark ? '#A8C4DC' : '#4B5563', border: `1px solid ${dark ? '#3B5B85' : '#D1D5DB'}`, borderRadius: 4, padding: '1px 6px' }}>{verdict.tag}</div>
      )}
      {verdict.line && <div data-testid="deal-verdict-line" style={{ marginTop: 4, fontSize: 12, color: dark ? '#C7D7EA' : '#6B7280' }}>{verdict.line}</div>}
    </div>
  );
}
