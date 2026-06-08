import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW } from '../shared/deckTokens';
import { getCompanyProfile, PROFILES_AS_OF } from '../../../lib/companyProfiles';

// Reference §3 — Company Profiles (qualitative).
// Side-by-side qualitative cards for the ACQUIRER (left) and TARGET (right).
// All values are sourced from the curated companyProfiles library (hand-compiled
// from public disclosures), NOT from the live free data stack — labeled as such.

export function SectionCompanyProfiles({ target, acquirer, deal, pageNum }) {
  const acquirerObj = acquirer || {};
  const targetObj = target || {};

  const acqProfile = getCompanyProfile(acquirerObj.ticker, acquirerObj.name);
  const tgtProfile = getCompanyProfile(targetObj.ticker, targetObj.name);

  const acqName = acquirerObj.name || acqProfile.name || 'Acquirer';
  const tgtName = targetObj.name || tgtProfile.name || 'Target';

  const subtitle = `${acqName} (acquirer) and ${tgtName} (target) — business and operating overview`;

  const sourceLine =
    `Qualitative profiles compiled from public company disclosures as of ${PROFILES_AS_OF}; ` +
    `not fetched data — verify against latest filings.`;

  // Rows rendered inside each card, in display order.
  const buildRows = (profile) => ([
    { label: 'Founded', value: profile.founded },
    { label: 'CEO', value: profile.ceo },
    { label: 'HQ', value: profile.hq },
    { label: 'Employees', value: profile.employees },
    { label: 'Business', value: profile.business },
    { label: 'Customer Profile', value: profile.customers },
    { label: 'Go-to-Market', value: profile.gtm },
    { label: 'Core Products', value: profile.products },
  ]);

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit B">
      <PageHeader title="Company Profiles" subtitle={subtitle} />

      <div style={{ padding: '16px 20px 36px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          <ProfileCard
            company={acquirerObj}
            displayName={acqName}
            profile={acqProfile}
            rows={buildRows(acqProfile)}
            tag="Acquirer"
          />
          <ProfileCard
            company={targetObj}
            displayName={tgtName}
            profile={tgtProfile}
            rows={buildRows(tgtProfile)}
            tag="Target"
          />
        </div>
      </div>

      {/* Source / footnote line */}
      <div style={{
        padding: '0 20px 14px',
        fontSize: 9,
        color: '#9CA3AF',
        fontStyle: 'italic',
        lineHeight: 1.4,
      }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}

function ProfileCard({ company, displayName, profile, rows, tag }) {
  const ticker = (company && company.ticker) ? String(company.ticker).toUpperCase() : '';

  return (
    <div style={{
      flex: '1 1 0',
      minWidth: 0,
      border: `1px solid ${GRAY_BORDER}`,
      borderRadius: 4,
      overflow: 'hidden',
      background: '#FFFFFF',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Card header */}
      <div style={{
        background: NAVY,
        padding: '9px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {displayName}
          </div>
          {ticker && (
            <div style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: 0.5,
              marginTop: 1,
            }}>
              {ticker}
            </div>
          )}
        </div>
        <div style={{
          flexShrink: 0,
          background: SF_BLUE,
          color: '#FFFFFF',
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          padding: '3px 7px',
          borderRadius: 3,
        }}>
          {tag}
        </div>
      </div>

      {/* Curation notice when profile is not hand-curated */}
      {!profile.curated && (
        <div style={{
          background: ALT_ROW,
          borderBottom: `1px solid ${GRAY_BORDER}`,
          padding: '6px 12px',
          fontSize: 9,
          color: '#9CA3AF',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}>
          Curated profile not available for this company — see latest 10-K / annual report.
        </div>
      )}

      {/* Attribute rows */}
      <div style={{ flex: '1 1 auto' }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '7px 12px',
              borderBottom: i < rows.length - 1 ? `1px solid ${GRAY_BORDER}` : 'none',
              background: i % 2 === 1 ? ALT_ROW : '#FFFFFF',
            }}
          >
            <div style={{
              flexShrink: 0,
              width: 92,
              fontSize: 10,
              fontWeight: 700,
              color: NAVY,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              lineHeight: 1.3,
              paddingTop: 1,
            }}>
              {row.label}
            </div>
            <div style={{
              flex: '1 1 0',
              minWidth: 0,
              fontSize: 11,
              color: '#1F2937',
              lineHeight: 1.4,
            }}>
              {(row.value === undefined || row.value === null || row.value === '') ? '—' : row.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
