import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';

// Phase 9 — Private Company Valuation. A private company has no share price, so its equity value cannot be
// read off a market. It is DERIVED here, in the open: a peer-median EV/EBITDA (from the sector the filing's
// business description was classified into) × EBITDA − net debt = equity value. Every figure that came from
// the filing carries its page cite; the multiple shows whether it is the peer median or a user entry. When
// the peer set was too thin, the multiple is user-entered and that is stated — never a silent default.
// Ownership split and the relative-valuation exchange ratio read the single source (deckModel), adjusted
// for the cash consideration. Leverage (pro-forma net debt/EBITDA, coverage) is on the Credit Stats exhibit.

const NAVY = '#0F2244';
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const fmtM = (v) => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString()}M)` : `$${Math.round(v).toLocaleString()}M`);
const fmtX = (v) => v == null ? '—' : `${(+v).toFixed(1)}×`;
const fmtPct = (v) => v == null ? '—' : `${(+v).toFixed(1)}%`;
const fmtDate = (iso) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

// Page cite for a required input, from the company's §16 provenance rows (single source of the page trail).
function citeFor(company, label) {
  const r = (company?.provenance?.rows || []).find((x) => x.label === label);
  if (!r) return null;
  if (r.source === 'user override') return 'user override';
  if (r.source === 'user input') return 'user input';
  return r.page ? `p.${r.page}` : (r.source || null);
}
// EBITDA = operating income + D&A → its cite combines both underlying page cites.
function ebitdaCite(company) {
  const rows = company?.provenance?.rows || [];
  const oi = rows.find((x) => x.label === 'Operating income');
  const da = rows.find((x) => x.label === 'D&A');
  const parts = [];
  if (oi) parts.push(oi.page ? `op inc p.${oi.page}` : (oi.source || 'op inc'));
  if (da) parts.push(da.page ? `D&A p.${da.page}` : (da.source || 'D&A'));
  return parts.length ? parts.join(' + ') : null;
}

function ValuationCard({ role, company }) {
  const v = company?.valuation;
  if (!v) return null;
  const name = company.name || company.ticker || role;
  const peerResolved = v.peersResolved && v.peers && v.peers.length;
  const multManual = v.multipleSource === 'user' || !peerResolved;

  const rows = [
    {
      label: `Enterprise value = ${v.multiple != null ? fmtX(v.multiple) + ' ×' : 'multiple ×'} EBITDA ${fmtM(v.ebitda)}`,
      val: fmtM(v.ev),
      cite: `EBITDA: ${ebitdaCite(company) || 'user input'}`,
    },
    {
      label: '− Net debt (total debt − cash)',
      val: fmtM(v.netDebt),
      cite: `debt ${citeFor(company, 'Total debt') || 'user input'} · cash ${citeFor(company, 'Cash') || 'user input'}`,
    },
    { label: '= Equity value', val: fmtM(v.equityValue), bold: true, cite: null },
  ];

  return (
    <div style={{ flex: 1, border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ background: NAVY, padding: '7px 12px' }}>
        <div style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{name}</div>
        <div style={{ color: '#A8C4DC', fontSize: 10 }}>{role}{v.sector ? ` · sector: ${v.sector}${v.sic ? ` (SIC ${v.sic})` : ''}` : ''}</div>
      </div>
      <div style={{ padding: '8px 12px' }}>
        {/* Multiple provenance */}
        {peerResolved ? (
          <div style={{ fontSize: 10.5, color: '#374151', marginBottom: 8, lineHeight: 1.5 }}>
            Multiple: <strong>{fmtX(v.multiple)}</strong>{v.multipleSource === 'user' ? ' (user-edited)' : ' — peer median'} of {v.n} peer{v.n === 1 ? '' : 's'}
            {fmtDate(v.asOf) ? ` as of ${fmtDate(v.asOf)}` : ''}
            {v.multipleSource !== 'user' && v.peerMedian != null ? '' : (v.peerMedian != null ? ` (peer median ${fmtX(v.peerMedian)})` : '')}
            <div style={{ color: '#6B7280', marginTop: 2 }}>
              {v.peers.map((p) => `${p.ticker} ${fmtX(p.evEbitda)}`).join(' · ')}
            </div>
            {v.peerSource === 'sic-group' && <div style={{ color: '#B45309', marginTop: 2 }}>⚠ group-level SIC match — peers may be cross-industry; multiple should be verified.</div>}
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: '#B45309', marginBottom: 8, lineHeight: 1.5 }}>
            Multiple: <strong>{fmtX(v.multiple)}</strong> — entered manually. {v.peerNote || 'No peer median was available for this sector.'}
          </div>
        )}
        {/* EV → net debt → equity bridge */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: i === rows.length - 1 ? `1px solid ${NAVY}` : '1px solid #F3F4F6', background: r.bold ? '#EFF6FF' : 'transparent' }}>
                <td style={{ padding: '5px 4px', color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 400 }}>
                  {r.label}
                  {r.cite && <div style={{ fontSize: 9, color: '#9CA3AF' }}>{r.cite}</div>}
                </td>
                <td style={{ padding: '5px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 400, whiteSpace: 'nowrap' }}>{r.val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SectionPrivateValuation({ target, acquirer, deal, model, pageNum, exhibitLabel }) {
  const d = model?.derived || {};
  const aVal = acquirer?.valuation;
  const tVal = target?.valuation;
  const anyVal = aVal || tVal;

  const aName = acquirer?.name || acquirer?.ticker || 'Acquirer';
  const tName = target?.name || target?.ticker || 'Target';

  // Relative valuation ratio (target equity ÷ acquirer equity) — the value-based "exchange ratio" for a
  // deal with no per-share price. From deckModel (single source).
  const relRatio = num(d.valuationExchangeRatio);
  const ownAcq = num(d.ownershipExistingPct);
  const ownTgt = num(d.ownershipNewPct);
  const ownBasis = d.ownershipBasis;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Private Company Valuation"
        subtitle="Peer-median EV/EBITDA × EBITDA − net debt = equity value — the market-based valuation a private deal cannot read off a share price"
      />
      <div style={{ padding: '14px 24px 20px' }}>
        {anyVal ? (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <ValuationCard role="Acquirer" company={acquirer} />
              <ValuationCard role="Target" company={target} />
            </div>

            {/* Relative valuation → ownership + exchange ratio */}
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ background: '#F9FAFB', padding: '6px 12px', fontSize: 11, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Relative valuation → pro-forma ownership
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '6px 12px', color: '#374151' }}>Equity value — {aName} / {tName}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtM(d.equityAcquirer)} / {fmtM(d.equityTarget)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '6px 12px', color: '#374151' }}>Relative valuation (target ÷ acquirer)</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{relRatio == null ? '—' : `${relRatio.toFixed(2)}×`}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '6px 12px', color: '#374151' }}>Stock consideration ({model?.dealAssumptions?.stockPercent != null ? Math.round(model.dealAssumptions.stockPercent) : '—'}% of purchase; cash portion does not dilute)</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtM(d.stockConsiderationEq)}</td>
                  </tr>
                  <tr style={{ background: '#EFF6FF' }}>
                    <td style={{ padding: '6px 12px', color: NAVY, fontWeight: 700 }}>Pro-forma ownership — {aName} / {tName}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: NAVY, fontWeight: 700 }}>{fmtPct(ownAcq)} / {fmtPct(ownTgt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 10.5, color: '#6B7280', fontStyle: 'italic', lineHeight: 1.5 }}>
              Equity value = peer-median EV/EBITDA × EBITDA − net debt (total debt − cash), each figure sourced to the uploaded filing’s page cite above.
              {ownBasis === 'equity-value' ? ' Ownership is the stock consideration’s share of pro-forma equity, adjusted for the cash portion (which does not issue ownership).' : ''}
              {' '}Pro-forma net debt/EBITDA and interest coverage are on the Pro-Forma Credit Statistics exhibit. Any absent input renders “—”, never a fabricated figure.
            </div>
          </>
        ) : (
          <div style={{ padding: '12px 14px', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 6, fontSize: 12, color: '#6B7280' }}>
            No private company in this deal — every side has public market data, so equity value is read from the market rather than derived.
          </div>
        )}
      </div>
    </PageFrame>
  );
}
