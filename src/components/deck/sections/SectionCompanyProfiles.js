import { apiUrl } from '../../../api';
import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtScaled, pickScale, fmtPct, isFinancial, fmtAsOf } from '../shared/deckTokens';
import { getCompanyProfile, PROFILES_AS_OF } from '../../../lib/companyProfiles';
import { enterpriseValue, NET_DEBT_BASIS } from '../../../lib/netDebt';

// US state full-name → 2-letter abbreviation for HQ display ("San Francisco, California" → "…, CA").
const US_STATE_ABBR = { 'California':'CA','New York':'NY','Texas':'TX','Washington':'WA','Massachusetts':'MA','Illinois':'IL','Georgia':'GA','Florida':'FL','Virginia':'VA','Colorado':'CO','Pennsylvania':'PA','New Jersey':'NJ','Ohio':'OH','North Carolina':'NC','Michigan':'MI','Minnesota':'MN','Oregon':'OR','Arizona':'AZ','Tennessee':'TN','Maryland':'MD','Connecticut':'CT','Missouri':'MO','Indiana':'IN','Wisconsin':'WI','Utah':'UT','Nevada':'NV','Delaware':'DE','District of Columbia':'DC' };
const abbrevState = (hq) => (typeof hq === 'string')
  ? hq.replace(new RegExp(`,\\s*(${Object.keys(US_STATE_ABBR).join('|')})(?![a-zA-Z])`), (_m, s) => `, ${US_STATE_ABBR[s]}`)
  : hq;

// Reference §3 — Company Profiles (qualitative).
// A SHARED-ROW two-column table (Field | Acquirer | Target): every attribute is one row spanning both
// companies, so fields align horizontally regardless of prose length (fixes the prior independent-card drift
// where variable-length Business/Customer/GTM pushed CEO/HQ out of line). The Key Financials table below uses
// the same pattern. Curated companies (companyProfiles library, hand-compiled from disclosures) supply the full
// qualitative field set; companies NOT in that library are populated live from FMP via /api/profile/:ticker
// (CEO / HQ / employees / industry / IPO date / description) — real fetched data, each field shown exactly as
// reported or "—", never fabricated. The two schemas differ, so the table renders the UNION of fields and shows
// "—" where one company lacks a field. "Public since" is the IPO date (FMP has no founding-year field), so it is
// labeled as such and never presented as a founding year.

const clip = (s, n = 300) => {
  if (!s) return null;
  const t = String(s).trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
};

export function SectionCompanyProfiles({ target, acquirer, deal, pageNum, exhibitLabel }) {
  const acquirerObj = acquirer || {};
  const targetObj = target || {};

  const acqProfile = getCompanyProfile(acquirerObj.ticker, acquirerObj.name, acquirerObj);
  const tgtProfile = getCompanyProfile(targetObj.ticker, targetObj.name, targetObj);

  // FMP profile (/api/profile — facts + LOGO image, fetched for BOTH companies so curated cards get a logo
  // too) and /api/pnl (forward revenue growth for the Key Financials block). Profile FIELDS are only used
  // when non-curated; the logo image is used regardless.
  const [acqFmp, setAcqFmp] = useState(null);
  const [tgtFmp, setTgtFmp] = useState(null);
  const [acqPnl, setAcqPnl] = useState(null);
  const [tgtPnl, setTgtPnl] = useState(null);
  // Stage 3: /quote carries data.ltm (revenue/grossProfit/operatingIncome/freeCashFlow, trusted-gated) —
  // the trailing-12mo actuals the Key Financials snapshot switches to. Fetched here (client-only); the
  // deck target/acquirer objects don't thread .ltm.
  const [acqQuote, setAcqQuote] = useState(null);
  const [tgtQuote, setTgtQuote] = useState(null);
  useEffect(() => {
    let cancel = false;
    const loadProfile = (ticker, set) => {
      if (!ticker) { set(null); return; }
      fetch(apiUrl(`/api/profile/${encodeURIComponent(ticker)}`))
        .then(r => r.json()).then(j => { if (!cancel) set(j && j.ok ? j : null); }).catch(() => { if (!cancel) set(null); });
    };
    const loadPnl = (ticker, set) => {
      if (!ticker) { set(null); return; }
      fetch(apiUrl(`/api/pnl/${encodeURIComponent(ticker)}`))
        .then(r => r.json()).then(j => { if (!cancel) set(j && j.ok && Array.isArray(j.columns) ? j : null); }).catch(() => { if (!cancel) set(null); });
    };
    const loadQuote = (ticker, set) => {
      if (!ticker) { set(null); return; }
      fetch(apiUrl(`/quote?symbol=${encodeURIComponent(ticker)}`))
        .then(r => r.json()).then(j => { if (!cancel) set(j || null); }).catch(() => { if (!cancel) set(null); });
    };
    loadProfile(acquirerObj.ticker, setAcqFmp);
    loadProfile(targetObj.ticker, setTgtFmp);
    loadPnl(acquirerObj.ticker, setAcqPnl);
    loadPnl(targetObj.ticker, setTgtPnl);
    loadQuote(acquirerObj.ticker, setAcqQuote);
    loadQuote(targetObj.ticker, setTgtQuote);
    return () => { cancel = true; };
  }, [acquirerObj.ticker, targetObj.ticker]);

  // ── Key Financials (real data from the deck's company objects + forward growth from /api/pnl) ──
  const buildKeyFin = (co, pnl, ltmRaw, assets) => {
    const num = (x) => x != null && x !== '' ? parseFloat(x) : null;
    const rev = num(co.revenue), gp = num(co.grossProfit), oi = num(co.operatingIncome), fcf = num(co.freeCashFlow);
    const cash = num(co.cash), debt = num(co.debt), sti = num(co.sti);
    const mcap = num(co.currentMarketCap) ?? num(co.marketCap);
    const ev = enterpriseValue(mcap, debt, cash, sti); // shared helper: cash bucket = cash + short-term marketable securities (b); null-aware
    const cols = pnl && Array.isArray(pnl.columns) ? pnl.columns : null;
    const fwd = cols ? cols.find(c => !c.actual) : null;
    const act = cols ? [...cols].reverse().find(c => c.actual) : null;
    const growth = (fwd && act && act.revenue) ? ((fwd.revenue - act.revenue) / act.revenue * 100) : null;
    // ── LTM basis (Stage 3): switch the ACTUAL flow items (revenue/gross margin/op margin/FCF) + the
    // EV/Rev DENOMINATOR to trailing-12mo when /quote carries a TRUSTED LTM; foreign/untrusted → FY,
    // flagged per-company. EV & market cap are point-in-time (not period figures) → unchanged.
    const T    = (ltmRaw && ltmRaw.trusted === true) ? ltmRaw : null;
    const revL = T && T.revenue != null ? num(T.revenue) : null;
    const gpL  = T && T.grossProfit != null ? num(T.grossProfit) : null;
    const oiL  = T && T.operatingIncome != null ? num(T.operatingIncome) : null;
    const fcfL = T && T.freeCashFlow != null ? num(T.freeCashFlow) : null;
    const revA = revL != null ? revL : (rev && rev > 0 ? rev : null);   // LTM if trusted, else FY annual
    const revBasis = revL != null ? 'LTM' : 'FY';
    // Bank metrics (from the SAME bank-facts fields §4/§5 render — single source of truth). Null-safe:
    // any missing input → null → "—". Only read by the BANK_ROWS view; null/unused for non-financials.
    const nii = num(co.netInterestIncome), noni = num(co.nonInterestIncome), none = num(co.nonInterestExpense);
    const ppnr = (nii != null && noni != null && none != null) ? nii + noni - none : null;
    const tbv = num(co.tangibleBookValue);
    const ptbv = (mcap != null && tbv != null && tbv !== 0) ? mcap / tbv : null;
    const cet1 = num(co.cet1Ratio);              // decimal (0.1076); rendered ×100 like §4/§5
    const deposits = num(co.totalDeposits);
    return {
      revenue: revA,
      revBasis, ltmAsOf: T ? T.asOf : null,
      growth,   // forward (NTM consensus) — unchanged
      grossMargin: (gpL != null && revL > 0) ? gpL / revL * 100 : ((gp != null && rev) ? gp / rev * 100 : null),
      opMargin:    (oiL != null && revL > 0) ? oiL / revL * 100 : ((oi != null && rev) ? oi / rev * 100 : null),
      fcf: fcfL != null ? fcfL : fcf,
      marketCap: mcap,   // point-in-time — unchanged
      debt, cash,        // point-in-time balance-sheet items — shown as separate lines (EV bridge)
      assets: assets != null ? Number(assets) : null,   // total assets at the balance-sheet anchor (7A Item 2) — from /quote, same instant as cash/debt

      ev,                // point-in-time (mktcap + net debt) — unchanged
      evRev: (ev != null && revA) ? ev / revA : null,   // current EV ÷ (LTM|FY) revenue
      // bank view
      ppnr, ptbv, cet1, deposits,
    };
  };
  const acqFin = buildKeyFin(acquirerObj, acqPnl, acqQuote?.ltm, acqQuote?.totalAssets);
  const tgtFin = buildKeyFin(targetObj, tgtPnl, tgtQuote?.ltm, tgtQuote?.totalAssets);
  // Standard (non-financial) Key Financials — the original, unchanged row set.
  const STANDARD_ROWS = [
    { label: 'Revenue',              fmt: (f) => f.revenue != null ? fmtMoneyTable(f.revenue) : '—', get: (f) => f.revenue },
    { label: 'Revenue growth (proj.)', fmt: (f) => f.growth != null ? `${f.growth >= 0 ? '+' : '−'}${Math.abs(f.growth).toFixed(1)}%` : '—', get: (f) => f.growth },
    { label: 'Gross margin (GAAP)',     fmt: (f) => f.grossMargin != null ? fmtPct(f.grossMargin) : '—', get: (f) => f.grossMargin },
    { label: 'Operating margin (GAAP)', fmt: (f) => f.opMargin != null ? fmtPct(f.opMargin) : '—', get: (f) => f.opMargin },
    { label: 'Free cash flow',       fmt: (f) => f.fcf != null ? fmtMoneyTable(f.fcf) : '—', get: (f) => f.fcf },
    { label: 'Equity value (mkt cap)', fmt: (f) => f.marketCap != null ? fmtMoneyTable(f.marketCap) : '—', get: (f) => f.marketCap },
    { label: 'Total debt',           fmt: (f) => f.debt != null ? fmtMoneyTable(f.debt) : '—', get: (f) => f.debt },
    { label: 'Cash & equivalents',   fmt: (f) => f.cash != null ? fmtMoneyTable(f.cash) : '—', get: (f) => f.cash },
    { label: 'Total assets',         fmt: (f) => f.assets != null ? fmtMoneyTable(f.assets) : '—', get: (f) => f.assets },
    { label: 'Enterprise value',     fmt: (f) => f.ev != null ? fmtMoneyTable(f.ev) : '—', get: (f) => f.ev },
    { label: 'EV / Revenue',         fmt: (f) => f.evRev != null ? `${f.evRev.toFixed(1)}x` : '—', get: (f) => f.evRev },
  ];
  // Bank view — banks have no meaningful gross/op margin, EBITDA or EV; suppress those and show the
  // bank income/capital metrics instead, reusing the same bank-facts fields §4/§5 render. Same formatters
  // (fmtMoneyTable for $ , fmtPct for CET1 ×100, x-multiple for P/TBV). Null → "—".
  const BANK_ROWS = [
    { label: 'Revenue',                  fmt: (f) => f.revenue != null ? fmtMoneyTable(f.revenue) : '—', get: (f) => f.revenue },
    { label: 'Pre-provision net revenue', fmt: (f) => f.ppnr != null ? fmtMoneyTable(f.ppnr) : '—', get: (f) => f.ppnr },
    { label: 'Price / tangible book',    fmt: (f) => f.ptbv != null ? `${f.ptbv.toFixed(1)}x` : '—', get: (f) => f.ptbv },
    { label: 'CET1 ratio',               fmt: (f) => f.cet1 != null ? fmtPct(f.cet1 * 100) : '—', get: (f) => f.cet1 },
    { label: 'Total deposits',           fmt: (f) => f.deposits != null ? fmtMoneyTable(f.deposits) : '—', get: (f) => f.deposits },
  ];
  // Deal-level gate: a shared-label two-column table needs ONE row set. Show the bank view only when BOTH
  // companies are financial (SIC-based isFinancial) — every non-financial deal keeps STANDARD_ROWS exactly.
  const bankView = isFinancial(acquirerObj) && isFinancial(targetObj);
  const KEYFIN_ROWS = bankView ? BANK_ROWS : STANDARD_ROWS;

  // ── Uniform table scale ($M vs $B) ──────────────────────────────────────────
  // fmtMoneyTable auto-switches to $B per-value at $10B, so this table could show "$26.9B" (revenue)
  // next to "$5,000M" (FCF) in one column — and contradict its own "($M)" header. Commit the whole
  // table to ONE scale chosen from all money values across both columns; pickScale stays in $M unless
  // every money value reads cleanly in $B, so a small target value never collapses to "$0.xB".
  const MONEY_LABELS = new Set(['Revenue', 'Free cash flow', 'Equity value (mkt cap)', 'Total debt',
    'Cash & equivalents', 'Total assets', 'Enterprise value', 'Pre-provision net revenue', 'Total deposits']);
  const isMoneyRow = (m) => MONEY_LABELS.has(m.label);
  const moneyScale = pickScale(KEYFIN_ROWS.filter(isMoneyRow).flatMap((m) => [m.get(acqFin), m.get(tgtFin)]));
  const scaleLabel = moneyScale === 'B' ? '$B' : '$M';
  const cellFor = (m, fin) => {
    if (!isMoneyRow(m)) return m.fmt(fin);
    const v = m.get(fin);
    return v != null ? fmtScaled(v, moneyScale) : '—';
  };

  const acqName = acquirerObj.name || acqProfile.name || 'Acquirer';
  const tgtName = targetObj.name || tgtProfile.name || 'Target';

  const subtitle = `${acqName} (acquirer) and ${tgtName} (target) — business and operating overview`;

  // Per-card data provenance: curated library → live FMP → neither (genuine no-data fallback).
  const srcOf = (profile, fmp) => profile.curated ? 'curated' : (fmp ? 'fmp' : 'none');
  const acqSrc = srcOf(acqProfile, acqFmp);
  const tgtSrc = srcOf(tgtProfile, tgtFmp);

  const anyCurated = acqSrc === 'curated' || tgtSrc === 'curated';
  const anyFmp = acqSrc === 'fmp' || tgtSrc === 'fmp';
  let sourceLine = '';
  if (anyCurated) sourceLine += `Curated qualitative profiles compiled from public company disclosures as of ${PROFILES_AS_OF}. `;
  if (anyFmp) sourceLine += `Live company facts (CEO, employees, HQ, industry, IPO date) and business descriptions sourced from Financial Modeling Prep — "Public since" reflects the IPO date, not the founding year. `;
  const asOfShort3 = (d) => { if (!d) return null; const t = new Date(d + 'T12:00:00Z'); return t.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(t.getUTCFullYear()).slice(2); };
  const acqAsOf3 = asOfShort3(acqQuote?.ltm?.trusted ? acqQuote.ltm.asOf : null);
  const tgtAsOf3 = asOfShort3(tgtQuote?.ltm?.trusted ? tgtQuote.ltm.asOf : null);
  const acqBs = fmtAsOf(acqQuote?.balanceSheetAsOf, acqQuote?.balanceSheetBasis);
  const tgtBs = fmtAsOf(tgtQuote?.balanceSheetAsOf, tgtQuote?.balanceSheetBasis);
  sourceLine += `Key Financials — revenue, margins, FCF and EV/Revenue are LTM (trailing 12 months); equity value & EV are point-in-time; a company marked "· FY" keeps the latest fiscal year (interim not tagged — foreign). ${NET_DEBT_BASIS}${acqBs && tgtBs ? ` Balance-sheet items are as of each company's latest interim balance sheet (acquirer ${acqBs}, target ${tgtBs}) — the same date as its LTM revenue.` : ''} The LTM basis aligns each company's window to within about one month${acqAsOf3 && tgtAsOf3 ? ` (acquirer LTM to ${acqAsOf3}, target LTM to ${tgtAsOf3})` : ''}, far tighter than the fiscal-year-end offset. Rounding: $ in millions ($M) unless a $B scale is noted in the header; per-share figures to 2 decimals, multiples to one decimal. Verify against latest filings.`;

  // Qualitative attributes as a label→value map per company. The shared-row table below renders the UNION of
  // labels across both companies in FIELD_ORDER, so every field aligns horizontally regardless of prose length
  // (fixes the independent-card drift). Curated and FMP schemas differ; a field absent for one company shows "—".
  const profileFields = (profile, fmp, src) => {
    if (src === 'fmp') {
      return {
        'CEO': fmp.ceo,
        'HQ': abbrevState(fmp.hq),
        'Employees': fmp.employees != null ? fmp.employees.toLocaleString('en-US') : null,
        'Industry': fmp.industry,
        'Public Since': fmp.ipoYear ? `${fmp.ipoYear} (IPO)` : null,
        'Website': fmp.website ? fmp.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
        'Business': clip(fmp.description, 240),
      };
    }
    // curated (full qualitative layout) and the no-data fallback share the curated/PROFILE_NA shape.
    return {
      'Founded': profile.founded,
      'CEO': profile.ceo,
      'HQ': abbrevState(profile.hq),
      'Employees': profile.employees,
      'Business': profile.business,
      'Customer Profile': profile.customers,
      'Go-to-Market': profile.gtm,
      'Core Products': profile.products,
    };
  };
  // Union of qualitative fields in display order — short/aligned fields first, prose last.
  const FIELD_ORDER = ['Founded', 'Public Since', 'CEO', 'HQ', 'Employees', 'Industry', 'Website',
    'Business', 'Customer Profile', 'Go-to-Market', 'Core Products'];
  const acqFields = profileFields(acqProfile, acqFmp, acqSrc);
  const tgtFields = profileFields(tgtProfile, tgtFmp, tgtSrc);
  const hasVal = (v) => v != null && v !== '';
  const profileRows = FIELD_ORDER
    .filter((l) => hasVal(acqFields[l]) || hasVal(tgtFields[l]))
    .map((l) => ({ label: l, acq: acqFields[l], tgt: tgtFields[l] }));
  // Header column meta (logo/name/ticker/tag/provenance) for the shared table.
  const profileCols = [
    { obj: acquirerObj, name: acqName, logo: acqFmp?.image || null, tag: 'Acquirer', src: acqSrc },
    { obj: targetObj,   name: tgtName, logo: tgtFmp?.image || null, tag: 'Target',   src: tgtSrc },
  ];
  const srcTag = (s) => s === 'fmp' ? ' · live (FMP)' : (s === 'none' ? ' · no curated profile' : '');

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader title="Company Profiles" subtitle={subtitle} />

      <div style={{ padding: '14px 20px 8px' }}>
        {/* Qualitative profile — shared-row two-column table: every field aligns horizontally across both
            companies regardless of prose length (fixes the independent-card drift). */}
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          {/* Header — company identity per column */}
          <div style={{ background: NAVY, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px' }}>
            <span style={{ width: 104, flexShrink: 0, color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Overview</span>
            {profileCols.map((c, i) => (
              <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <LogoChip src={c.logo} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8.5, fontWeight: 600, letterSpacing: 0.4 }}>
                    {(c.obj.ticker ? String(c.obj.ticker).toUpperCase() + ' · ' : '')}{c.tag}{srcTag(c.src)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Field rows — shared row per attribute */}
          {profileRows.map((row, i) => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 10px', background: i % 2 ? ALT_ROW : '#FFFFFF', borderTop: `1px solid ${GRAY_BORDER}` }}>
              <span style={{ width: 104, flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1.3, paddingTop: 1 }}>{row.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: '#1F2937', lineHeight: 1.4 }}>{hasVal(row.acq) ? row.acq : '—'}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: '#1F2937', lineHeight: 1.4 }}>{hasVal(row.tgt) ? row.tgt : '—'}</span>
            </div>
          ))}
        </div>

        {/* Key Financials — real data from the deck's company objects + forward growth (/api/pnl). */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Financials ({scaleLabel} · LTM, except margins &amp; multiples)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
              <span style={{ flex: 2, color: '#fff', fontSize: 10, fontWeight: 700 }}>Metric</span>
              <span style={{ flex: 1.3, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{acquirerObj.ticker || acqName}{acqFin.revBasis === 'FY' ? ' · FY' : ''}</span>
              <span style={{ flex: 1.3, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{targetObj.ticker || tgtName}{tgtFin.revBasis === 'FY' ? ' · FY' : ''}</span>
            </div>
            {KEYFIN_ROWS.map((m, i) => (
              <div key={m.label} style={{ display: 'flex', padding: '4px 10px', background: i % 2 ? ALT_ROW : '#fff', borderBottom: `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2, fontSize: 9.5, color: NAVY, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>{m.label}</span>
                <span style={{ flex: 1.3, fontSize: 10.5, textAlign: 'right', fontWeight: 600, color: (typeof m.get(acqFin) === 'number' && m.get(acqFin) < 0) ? '#DC2626' : NAVY }}>{cellFor(m, acqFin)}</span>
                <span style={{ flex: 1.3, fontSize: 10.5, textAlign: 'right', fontWeight: 600, color: (typeof m.get(tgtFin) === 'number' && m.get(tgtFin) < 0) ? '#DC2626' : NAVY }}>{cellFor(m, tgtFin)}</span>
              </div>
            ))}
          </div>
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

function LogoChip({ src }) {
  const [ok, setOk] = React.useState(true); // hide the chip if the image fails to load
  if (!src || !ok) return null;
  return (
    <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 5, background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <img src={src} alt="" onError={() => setOk(false)} style={{ maxWidth: 22, maxHeight: 22, objectFit: 'contain' }} />
    </div>
  );
}
