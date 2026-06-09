import React from 'react';
import { PageFrame } from '../shared/PageFrame';

const MONTH_LABELS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

export function SectionTitlePage({ target, acquirer }) {
  const now = new Date();
  const dateStr = `${MONTH_LABELS[now.getMonth()]} ${now.getFullYear()}`;
  const acqName = acquirer?.name || 'Acquirer';
  const tgtName = target?.name || 'Target Company';

  return (
    <PageFrame variant="cover">
      {/* DRAFT stamp on cover */}
      <div style={{
        position: 'absolute', top: 20, right: 24,
        color: '#fff', fontSize: 8, fontWeight: 700,
        letterSpacing: 1.5, textTransform: 'uppercase',
        border: '1px solid rgba(255,255,255,0.6)', padding: '2px 6px', borderRadius: 2,
        opacity: 0.8,
      }}>
        DRAFT &amp; CONFIDENTIAL
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'flex-start', padding: '80px 60px 60px',
        minHeight: 620, boxSizing: 'border-box',
      }}>
        {/* Thin accent line */}
        <div style={{ width: 48, height: 3, background: '#fff', opacity: 0.5, marginBottom: 32 }} />

        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.65)',
          letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20, fontWeight: 600,
        }}>
          M&amp;A Advisory
        </div>

        <div style={{
          fontSize: 40, fontWeight: 900, color: '#fff',
          lineHeight: 1.12, marginBottom: 18, letterSpacing: -1,
        }}>
          {acqName}<br />
          <span style={{ fontWeight: 400, fontSize: 28, color: 'rgba(255,255,255,0.75)' }}>acquires</span><br />
          {tgtName}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 48 }}>
          {acquirer?.ticker && (
            <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 4, letterSpacing: 1 }}>
              {acquirer.ticker}
            </div>
          )}
          {acquirer?.ticker && target?.ticker && (
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, alignSelf: 'center' }}>→</span>
          )}
          {target?.ticker && (
            <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 4, letterSpacing: 1 }}>
              {target.ticker}
            </div>
          )}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 48 }}>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, marginBottom: 10, maxWidth: 520, lineHeight: 1.5 }}>
            Prepared with EasyM&amp;A. Fundamentals sourced from SEC EDGAR filings; live market prices and 52-week ranges from CNBC and Nasdaq; analyst targets from Nasdaq and StockAnalysis.com.
            Deal terms, synergies and projections are illustrative transaction assumptions. Not investment advice.
          </div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginBottom: 6 }}>
            {dateStr}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: 0.5 }}>
            Easy<span style={{ color: 'rgba(255,255,255,0.6)' }}>M&A</span>
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
