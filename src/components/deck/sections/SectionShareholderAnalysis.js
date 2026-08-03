import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtShares } from '../shared/deckTokens';

// Shareholder Analysis — renders ONE of three states from /api/shareholder (the validated def14aParser output):
//   (a) trusted single-class holder table, (b) trusted dual-class (Name/A/B/Voting) with the voting-control
//   headline, (c) honest FMP ownership-structure fallback (float + insider Form-4). NEVER a top-holder table
//   from untrusted data — the parser's validation verdict (result.trusted) is binding at the render layer too.

const MAX_ROWS = 16;
const cleanName = (n) => (n || '').split(/\s+\(\d+\)/)[0].replace(/\s{2,}.*$/, '').trim(); // strip footnote "(n)" + trailing address
const roleLabel = (s) => (s === '5% holder' ? '5% Holder' : s === 'insider' ? 'Director / Officer' : '—');
const roleColor = (s) => (s === '5% holder' ? '#0B5CAB' : s === 'insider' ? '#6B7280' : '#9CA3AF');
const fmtPctVal = (p) => (p == null ? '—' : p === '*' ? '<1%' : p === '-' ? '—' : (typeof p === 'number' ? `${p.toFixed(p < 10 ? 2 : 1)}%` : String(p)));
const fmtSh = (v) => (v == null ? '—' : fmtShares(v / 1e6)); // v is raw shares; fmtShares expects millions

function RoleBadge({ section }) {
  return <span style={{ fontSize: 8, fontWeight: 700, color: roleColor(section), background: '#F3F4F6', border: `1px solid ${GRAY_BORDER}`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{roleLabel(section)}</span>;
}

export function SectionShareholderAnalysis({ target, pageNum }) {
  const tk = target?.ticker;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!tk);
  useEffect(() => {
    let cancel = false;
    if (!tk) { setLoading(false); return; }
    setLoading(true);
    fetch(`http://localhost:3001/api/shareholder/${encodeURIComponent(tk)}`)
      .then(r => r.json()).then(d => { if (!cancel) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancel) { setData({ trusted: false, reason: 'fetch failed' }); setLoading(false); } });
    return () => { cancel = true; };
  }, [tk]);

  const name = target?.name || 'Target';
  const trusted = !!data?.trusted;
  const dual = !!data?.dualClass;
  const holders = Array.isArray(data?.holders) ? data.holders : [];
  const shown = holders.slice(0, MAX_ROWS);
  const overflow = holders.length - shown.length;
  const val = data?.validation;
  const filingDate = data?.filing?.date;

  // Dual-class voting-control headline: the group/aggregate row's voting %, or the sum of insider voting.
  const groupRow = holders.find(h => /as a group|all (current )?(executive|named executive|directors)/i.test(h.name));
  const insiderVoting = groupRow?.votingPct ?? (dual ? holders.filter(h => h.section === 'insider' && typeof h.votingPct === 'number').reduce((a, h) => a + h.votingPct, 0) : null);

  const th = (label, align = 'right') => ({ padding: '5px 8px', background: NAVY, color: '#fff', fontSize: 9, fontWeight: 700, textAlign: align, whiteSpace: 'nowrap' });
  const td = (align = 'right', bold = false) => ({ padding: '4px 8px', borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10, textAlign: align, fontWeight: bold ? 700 : 400, color: bold ? NAVY : '#374151' });

  const tieFootnote = val
    ? `Holdings reconcile to ~${(val.impliedTotal || 0).toLocaleString()} shares vs ${(val.outstandingShares || 0).toLocaleString()} reported (${val.tieErrPct}% variance)${filingDate ? ` · DEF 14A ${filingDate}` : ''}. Beneficial ownership per SEC DEF 14A; percentages of class as of the record date.`
    : '';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit D">
      <PageHeader
        title={`Shareholder Analysis — ${name}`}
        subtitle={trusted
          ? `${dual ? 'Dual-class' : 'Single-class'} beneficial ownership · 5% holders + directors/officers · SEC DEF 14A`
          : 'Reported ownership structure & insider activity'}
      />

      <div style={{ padding: '14px 20px 10px' }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 12, fontStyle: 'italic' }}>Loading beneficial-ownership data…</div>
        ) : trusted && dual ? (
          /* ── (b) TRUSTED DUAL-CLASS ─────────────────────────────────────────────────────────────── */
          <>
            {insiderVoting != null && insiderVoting > 0 && (
              <div style={{ marginBottom: 12, padding: '9px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4, fontSize: 11, color: '#1E3A5F' }}>
                <strong style={{ color: NAVY }}>Founder / insider voting control: {insiderVoting.toFixed(1)}%</strong> — the Class B super-voting shares concentrate voting power well above economic ownership. Any acquisition requires their support.
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th('left')}>Beneficial Owner</th><th style={th('left')}>Role</th>
                <th style={th()}>Class A</th><th style={th()}>%</th>
                <th style={th()}>Class B</th><th style={th()}>%</th>
                <th style={th()}>Voting %</th>
              </tr></thead>
              <tbody>
                {shown.map((h, i) => {
                  const isFounder = (h.classB || 0) > 0 && h.section === 'insider';
                  return (
                    <tr key={i} style={{ background: isFounder ? '#EAF3FC' : (i % 2 ? ALT_ROW : '#fff') }}>
                      <td style={{ ...td('left', isFounder), background: 'inherit' }}>{cleanName(h.name)}</td>
                      <td style={{ ...td('left'), background: 'inherit' }}><RoleBadge section={h.section} /></td>
                      <td style={{ ...td(), background: 'inherit' }}>{fmtSh(h.classA)}</td>
                      <td style={{ ...td(), background: 'inherit', color: '#6B7280' }}>{fmtPctVal(h.pctA)}</td>
                      <td style={{ ...td('right', isFounder), background: 'inherit' }}>{fmtSh(h.classB)}</td>
                      <td style={{ ...td(), background: 'inherit', color: '#6B7280' }}>{fmtPctVal(h.pctB)}</td>
                      <td style={{ ...td('right', isFounder), background: 'inherit', color: isFounder ? SF_BLUE : NAVY }}>{fmtPctVal(h.votingPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {overflow > 0 && <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' }}>… and {overflow} other named holder{overflow === 1 ? '' : 's'}.</div>}
            <div style={{ marginTop: 8, fontSize: 8.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
              <strong>Class C (non-voting) shares are omitted per the filer's proxy</strong> — this table is Class A + Class B; voting % reflects Class B's super-vote and differs from economic ownership. {tieFootnote}
            </div>
          </>
        ) : trusted ? (
          /* ── (a) TRUSTED SINGLE-CLASS ───────────────────────────────────────────────────────────── */
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th('left')}>Beneficial Owner</th><th style={th('left')}>Role</th>
                <th style={th()}>Shares</th><th style={th()}>% of Class</th>
              </tr></thead>
              <tbody>
                {shown.map((h, i) => (
                  <tr key={i} style={{ background: i % 2 ? ALT_ROW : '#fff' }}>
                    <td style={{ ...td('left'), background: 'inherit' }}>{cleanName(h.name)}</td>
                    <td style={{ ...td('left'), background: 'inherit' }}><RoleBadge section={h.section} /></td>
                    <td style={{ ...td(), background: 'inherit' }}>{fmtSh(h.shares)}</td>
                    <td style={{ ...td(), background: 'inherit', color: '#6B7280' }}>{fmtPctVal(h.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {overflow > 0 && <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' }}>… and {overflow} other named holder{overflow === 1 ? '' : 's'}.</div>}
            <div style={{ marginTop: 8, fontSize: 8.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>{tieFootnote}</div>
          </>
        ) : (
          /* ── (c) FALLBACK — ownership STRUCTURE, not a top-holder roster ─────────────────────────── */
          <>
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 6, fontSize: 10.5, color: '#92400E' }}>
              Detailed beneficial-ownership table unavailable for {tk || 'this filer'}{data?.reason ? ` (${data.reason})` : ''} — showing <strong>reported ownership structure</strong>, not a top-holder roster.
            </div>
            {data?.float && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>Ownership Structure</div>
                <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                  {[
                    ['Shares outstanding', data.float.outstandingShares != null ? `${(data.float.outstandingShares / 1e6).toFixed(1)}M` : '—'],
                    ['Public free float', data.float.freeFloatPct != null ? `${Number(data.float.freeFloatPct).toFixed(1)}%` : '—'],
                    ['Restricted / insider-held', data.float.restrictedPct != null ? `${Number(data.float.restrictedPct).toFixed(1)}%` : '—'],
                  ].map(([k, v], i) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: i % 2 ? ALT_ROW : '#fff', borderBottom: i === 2 ? 'none' : `1px solid ${GRAY_BORDER}` }}>
                      <span style={{ fontSize: 10.5, color: '#374151' }}>{k}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: NAVY }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>Recent Insider Activity <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(SEC Form 4 — not a complete roster)</span></div>
            {Array.isArray(data?.insiders) && data.insiders.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {/* Faculty (7D-4a): raw share counts span orders of magnitude (e.g. a founder's ~880M vs a
                    director's ~4K) — add % of shares outstanding alongside the raw count so holdings are
                    comparable. New DERIVED column (holding ÷ current S/O); no existing value moves. */}
                <thead><tr><th style={th('left')}>Insider</th><th style={th('left')}>Role</th><th style={th('left')}>Last txn</th><th style={th()}>Shares owned</th><th style={th()}>% of S/O</th><th style={th('left')}>Date</th></tr></thead>
                <tbody>
                  {data.insiders.slice(0, 10).map((ins, i) => {
                    const so = data.float?.outstandingShares != null ? Number(data.float.outstandingShares) : null;
                    const pctSO = (ins.owned != null && so > 0) ? (Number(ins.owned) / so) * 100 : null;
                    return (
                    <tr key={i} style={{ background: i % 2 ? ALT_ROW : '#fff' }}>
                      <td style={{ ...td('left'), background: 'inherit' }}>{cleanName(ins.name)}</td>
                      <td style={{ ...td('left'), background: 'inherit', fontSize: 9, color: '#6B7280' }}>{(ins.role || '').slice(0, 28)}</td>
                      <td style={{ ...td('left'), background: 'inherit', fontSize: 9 }}>{(ins.type || '').replace(/^[A-Z]-/, '')}</td>
                      <td style={{ ...td(), background: 'inherit' }}>{ins.owned != null ? Number(ins.owned).toLocaleString() : '—'}</td>
                      <td style={{ ...td(), background: 'inherit', color: '#6B7280' }}>{pctSO != null ? `${pctSO < 0.01 ? '<0.01' : pctSO.toFixed(2)}%` : '—'}</td>
                      <td style={{ ...td('left'), background: 'inherit', fontSize: 9, color: '#9CA3AF' }}>{ins.date || '—'}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '14px', textAlign: 'center', fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>No recent insider Form-4 activity reported.</div>
            )}
            {/* Faculty (7D-4b): disclose the list's BASIS to §16's provenance standard — source, as-of, inclusion rule. */}
            <div style={{ marginTop: 8, fontSize: 8.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
              <strong>Insider list basis:</strong> the 10 most recent SEC Form-4 filers (§16 officers, directors &amp; 10% owners). <strong>Shares owned</strong> is each insider's beneficial holding reported on their latest Form 4, as of the <strong>Date</strong> shown; <strong>% of S/O</strong> is that holding ÷ current shares outstanding — approximate, since the holdings are reported on differing dates. This is recent insider <em>transaction</em> activity (Form 4), not a complete beneficial-ownership roster (a full DEF 14A / 13F top-holder table is not available for this filer). Free float &amp; shares outstanding from SEC-reported filings (Financial Modeling Prep).
            </div>
          </>
        )}
      </div>
    </PageFrame>
  );
}
