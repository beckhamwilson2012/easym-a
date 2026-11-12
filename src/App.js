import { apiUrl } from './api';
import { useState, useRef, useEffect } from 'react';
import Select from 'react-select';
import { DeckShell } from './components/deck/DeckShell';
import { SectionScreening } from './components/deck/sections/SectionScreening';
import { pnlFetch } from './components/deck/sections/SectionProFormaPL';
import { calculate, acquisitionNewDebt, MIN_CASH_PCT_DEFAULT } from './utils/dealCalc';
import { useWindowWidth } from './hooks/useWindowWidth';
import { getBankFacts } from './services/edgarBankFacts';
import { fetchLivePrice, fetchCloseOn } from './services/priceService';
import { SuggestionBadge } from './components/shared/SuggestionBadge';
import { PremiumSlider } from './components/shared/PremiumSlider';
import { SuggestedPremiumBox } from './components/shared/SuggestedPremiumBox';
import { PriceTiles } from './components/shared/PriceTiles';
import { CashFundingBox } from './components/shared/CashFundingBox';
import { CashPercentageSlider } from './components/shared/CashPercentageSlider';
import { fmtMoneyDual, fmtMoney, fmtPerShare, isFinancial, isBankDeal } from './components/deck/shared/deckTokens';
import { buildCashPercentTooltip } from './lib/suggestionTooltips';
import { SynergyInputs } from './components/shared/SynergyInputs';
import { CompanyBasisToggle } from './components/shared/CompanyBasisToggle';
import { ReportingBasisToggle } from './components/shared/ReportingBasisToggle';
import { NON_GAAP, nonGaapAvailability, effectiveBasis, resolveReportingBasis, applyReportingBasis } from './lib/reportingBasis';
import { synergySchedule } from './lib/synergies';
import { BASIS_FY, ltmAvailability, companyInputs, combination } from './lib/companyBasis';
import { DEFAULT_PREMIUM_PCT, liveSpot, offerFromPremium, formatOfferInput, firstForwardColumn, highestAccretivePremium, premiumReference, PRICE_BASIS_TODAY } from './lib/offerPremium';
import './App.css';

// ── API helpers ───────────────────────────────────────────────────────────────

function searchTickers(query) {
  return fetch(apiUrl(`/search?q=${query}`))
    .then(r => r.json())
    .then(data => data.map(item => ({ value: item.symbol, label: `${item.symbol} — ${item.name}` })))
    .catch(() => []);
}

function fetchCompanyData(symbol) {
  return fetch(apiUrl(`/quote?symbol=${symbol}`))
    .then(r => r.json())
    .then(data => { if (data.error) throw new Error(data.error); return data; });
}

// Company-reported annual NON-GAAP figures (adjusted diluted EPS with its net income and share count;
// adjusted EBITDA under the company's own name) read from the fiscal year-end earnings release's own
// reconciliation tables, period-matched to the deck FY and tied to GAAP server-side. Which of them the
// deal uses is decided by the GAAP | Non-GAAP toggle (src/lib/reportingBasis.js). Returns the full
// payload (or null on any failure); never throws.
function fetchNonGaap(symbol) {
  return fetch(apiUrl(`/api/nongaap/${symbol}`))
    .then(r => r.json())
    .catch(() => null);
}

// Wait-then-build timeout (#5): a hung non-GAAP fetch must never block the deck forever. After this,
// build on whatever has settled (a lookup still in flight counts as unavailable → GAAP).
const BASIS_WAIT_TIMEOUT_MS = 22000;

// ── UI components ─────────────────────────────────────────────────────────────

// Values the user entered show in blue. Pre-filled figures stay in the default color until edited.
const USER_ENTERED_BLUE = '#1a5fd0';
const inputBaseStyle = (disabled, userEntered) => ({
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14,
  boxSizing: 'border-box', background: disabled ? '#F9FAFB' : '#fff', color: disabled ? '#9CA3AF' : (userEntered ? USER_ENTERED_BLUE : 'inherit'),
});

function InputField({ label, name, value, onChange, disabled, note, placeholder, format, userEntered }) {
  const inputRef = useRef(null);
  const [typed, setTyped] = useState(false);
  const show = (v) => format ? format(v) : (v === 0 ? '' : String(v));
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = show(value);
      setTyped(false);   // the value changed from elsewhere (a new company, a reset), so it isn't the user's entry
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: disabled ? '#9CA3AF' : '#6B7280', marginBottom: 4 }}>{label}</label>
      <input ref={inputRef} type="number" step="any" name={name} defaultValue={show(value)}
        placeholder={placeholder || ''} onChange={(e) => { setTyped(true); onChange(e); }} disabled={disabled}
        style={inputBaseStyle(disabled, typed || userEntered)} />
      {note && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic' }}>{note}</div>}
    </div>
  );
}

// Large-number input — displays comma separators while keeping state as a clean number.
function LargeNumericField({ label, name, value, onChange, disabled, note, placeholder }) {
  const inputRef = useRef(null);
  const [typed, setTyped] = useState(false);
  const fmt = (v) => (v === 0 || v === '') ? '' : Number(v).toLocaleString('en-US');

  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = fmt(value);
      setTyped(false);   // the value changed from elsewhere (a new company, a reset), so it isn't the user's entry
    }
  }, [value]);

  const handleInput = (e) => {
    setTyped(true);
    const cleaned = e.target.value.replace(/,/g, '');
    onChange({ target: { name, value: cleaned } });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: disabled ? '#9CA3AF' : '#6B7280', marginBottom: 4 }}>{label}</label>
      <input ref={inputRef} type="text" inputMode="decimal" name={name}
        defaultValue={fmt(value)} placeholder={placeholder || ''}
        onChange={handleInput} disabled={disabled}
        style={inputBaseStyle(disabled, typed)} />
      {note && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic' }}>{note}</div>}
    </div>
  );
}

// ── Phase 5 (upload → Manual Entry) helpers ────────────────────────────────────
// Page-cite line shown under an upload-prefilled field: green = clean, amber = review
// (bundled/qualified), red = not found. A user edit replaces it with "source: user override".
function ExtractCite({ cite, overridden }) {
  if (overridden) return <div style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 10, fontStyle: 'italic' }}>✎ source: user override</div>;
  if (!cite) return null;
  if (cite.status === 'missing') return <div style={{ fontSize: 11, color: '#DC2626', marginTop: -8, marginBottom: 10 }}>— not found in upload — enter manually</div>;
  const amber = cite.status === 'review';
  return <div style={{ fontSize: 11, color: amber ? '#B45309' : '#059669', marginTop: -8, marginBottom: 10 }}>{amber ? '⚠ review · ' : '✓ '}p.{cite.page} · {cite.label}</div>;
}
// EBITDA is operating income + D&A, so its cite combines both underlying cites.
function ebitdaCite(u) {
  if (!u || !u.fields) return null;
  const e = u.fields.ebit, d = u.fields.da;
  if ((!e || e.value == null) && (!d || d.value == null)) return null;
  const status = ((e && e.status === 'missing') || (d && d.status === 'missing')) ? 'missing'
               : ((e && e.status === 'review') || (d && d.status === 'review')) ? 'review' : 'ok';
  return { status, page: e && e.page, label: `Op income p.${e && e.page} + D&A p.${d && d.page}` };
}
// Dropzone that POSTs a 10-K PDF to /api/extract and pre-fills a panel's six fields.
function UploadZone({ uploading, error, onFile }) {
  const ref = useRef(null);
  return (
    <div style={{ border: '1px dashed #C7D2FE', background: '#F5F7FF', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
      <input ref={ref} type="file" accept="application/pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#4338CA' }}>{uploading ? '⟳ Extracting 10-K (locate → extract → validate)…' : 'Pre-fill from a 10-K PDF — every figure page-cited'}</span>
        <button type="button" disabled={uploading} onClick={() => ref.current && ref.current.click()}
          style={{ background: '#4338CA', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1, flexShrink: 0 }}>Upload PDF</button>
      </div>
      {error && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
// Editable document facts (scale/currency/fiscal-year-end) parsed from the uploaded filing.
function DocFactsPanel({ facts, onChange }) {
  if (!facts) return null;
  const cell = (label, key, opts) => (
    <div style={{ flex: 1, minWidth: 88 }}>
      <label style={{ display: 'block', fontSize: 10, color: '#6B7280', marginBottom: 2 }}>{label}</label>
      {opts
        ? <select value={facts[key] || ''} onChange={e => onChange({ ...facts, [key]: e.target.value })} style={{ width: '100%', fontSize: 12, padding: '3px 4px', border: '1px solid #D1D5DB', borderRadius: 4 }}>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>
        : <input value={facts[key] || ''} onChange={e => onChange({ ...facts, [key]: e.target.value })} style={{ width: '100%', fontSize: 12, padding: '3px 4px', border: '1px solid #D1D5DB', borderRadius: 4 }} />}
    </div>
  );
  return (
    <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: 8, marginBottom: 12, display: 'flex', gap: 8 }}>
      {cell('Scale', 'scale', ['millions', 'thousands', 'billions'])}
      {cell('Currency', 'currency')}
      {cell('Fiscal year end', 'fiscalYearEnd')}
    </div>
  );
}

// Phase 9 — private valuation panel. For a private company the equity value is DERIVED, not typed blind:
// a peer-median EV/EBITDA (from the filing's classified sector) × EBITDA − net debt. The sector is an
// EDITABLE dropdown, not a fact — the classifier's pick is a default the user can switch. When the top two
// sectors are close, the panel says so and shows what EACH would imply (the swing is the user's call, not
// the model's). The multiple is pre-filled and editable; peers + count + as-of are shown. When peer
// resolution fails or is too thin, the failure is SURFACED and the user enters a multiple — never a default.
function ValuationPanel({ panel, valuation, altValuation, classification, sectorList, selectedSic, multiple, ebitda, debt, cash, onMultipleChange, onSectorChange, overridden }) {
  const mult = parseFloat(multiple) || 0;
  const eb = parseFloat(ebitda);
  const dbt = parseFloat(debt), csh = parseFloat(cash);
  const netDebt = (Number.isFinite(dbt) && Number.isFinite(csh)) ? dbt - csh : null;
  const ev = (mult > 0 && Number.isFinite(eb)) ? mult * eb : null;
  const equity = (ev != null && netDebt != null) ? ev - netDebt : null;
  const fmtM = v => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString()}M)` : `$${Math.round(v).toLocaleString()}M`);
  const fmtB = v => v == null ? '—' : (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}B` : `$${Math.round(v).toLocaleString()}M`);
  const fmtX = v => v == null ? '—' : `${(+v).toFixed(1)}×`;
  const fmtDate = iso => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const resolved = !!(valuation && valuation.ok && valuation.peers && valuation.peers.length);
  const failed = !!(valuation && !valuation.ok);
  const curSic = selectedSic || (classification && classification.sic) || '';
  // equity value a given median would imply (for the ambiguity comparison)
  const impliedEquity = (m) => (m != null && Number.isFinite(eb) && netDebt != null) ? m * eb - netDebt : null;
  // Show the swing when the classification is not high-confidence and a runner-up median resolved.
  const showAmbiguity = !!(classification && classification.confidence !== 'high' && altValuation && altValuation.ok && resolved && valuation.sic !== altValuation.sic);
  return (
    <div style={{ border: '1px solid #E5E7EB', background: '#FCFCFD', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#0F2244', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Private valuation — peer-median EV/EBITDA</div>

      {/* Editable sector — the classifier's pick is a default, not a fact */}
      <label style={{ display: 'block', fontSize: 11, color: '#6B7280', marginBottom: 3 }}>
        Sector{classification ? ` — classified as ${classification.sector} (${classification.confidence} confidence); switch if wrong` : ''}
      </label>
      <select value={curSic} onChange={e => onSectorChange(e.target.value)}
        style={{ width: '100%', fontSize: 13, padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: 6, marginBottom: 8, background: '#fff' }}>
        {!curSic && <option value="">— select a sector —</option>}
        {(sectorList || []).map(s => <option key={s.sic} value={s.sic}>{s.sector} (SIC {s.sic})</option>)}
      </select>

      {/* Ambiguity: the two close sectors and what each would imply */}
      {showAmbiguity && (
        <div style={{ fontSize: 11, color: '#374151', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '6px 8px', marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ This filing fits two sectors — the choice materially moves the valuation. Pick one:
          <div style={{ marginTop: 3 }}>· <strong>{valuation.sector}</strong> {fmtX(valuation.median)} → equity <strong>{fmtB(impliedEquity(valuation.median))}</strong></div>
          <div>· <strong>{altValuation.sector}</strong> {fmtX(altValuation.median)} → equity <strong>{fmtB(impliedEquity(altValuation.median))}</strong></div>
        </div>
      )}

      {resolved && (
        <div style={{ fontSize: 11, color: '#059669', marginBottom: 6, lineHeight: 1.5 }}>
          ✓ median {fmtX(valuation.median)} from {valuation.n} peer{valuation.n === 1 ? '' : 's'}{fmtDate(valuation.asOf) ? ` (as of ${fmtDate(valuation.asOf)})` : ''}: {valuation.peers.map(p => `${p.ticker} ${fmtX(p.evEbitda)}`).join(', ')}
          {valuation.source === 'sic-group' && <span style={{ color: '#B45309' }}> · ⚠ group-level match — verify</span>}
        </div>
      )}
      {failed && (
        <div style={{ fontSize: 11, color: '#B45309', marginBottom: 6, lineHeight: 1.5 }}>⚠ No peer median — {valuation.note} Enter a multiple below.</div>
      )}
      <LargeNumericField label="EV / EBITDA multiple (×)" name={`company${panel}ValuationMultiple`} value={multiple} onChange={onMultipleChange} placeholder="×" />
      {overridden && <div style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 8, fontStyle: 'italic' }}>✎ multiple edited by user</div>}
      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.8, marginTop: 2, paddingTop: 6, borderTop: '1px solid #F3F4F6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>EV = {mult > 0 ? `${fmtX(mult)} × ` : 'multiple × '}EBITDA {fmtM(Number.isFinite(eb) ? eb : null)}</span><strong>{fmtM(ev)}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>− Net debt (total debt − cash)</span><strong>{fmtM(netDebt)}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#0F2244', fontWeight: 700 }}><span>= Equity value</span><span>{fmtM(equity)}</span></div>
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function Hint({ children, onUse }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
      padding: '6px 10px', marginBottom: 8, fontSize: 12 }}>
      <span style={{ color: '#6B7280' }}>{children}</span>
      {onUse && <button onClick={onUse} style={{ background: '#0F2244', color: '#fff', border: 'none',
        borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginLeft: 8, flexShrink: 0 }}>Use this</button>}
    </div>
  );
}

const SOURCE_LABEL = { sec_edgar: 'SEC EDGAR', fmp: 'FMP', yahoo: 'Yahoo Finance' };

const selectStyles = {
  control: (base) => ({ ...base, borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14, minHeight: 38,
    boxShadow: 'none', '&:hover': { border: '1px solid #0F2244' } }),
  option: (base, state) => ({ ...base, fontSize: 13, backgroundColor: state.isFocused ? '#EFF6FF' : '#fff',
    color: '#111827', cursor: 'pointer' }),
  menu: (base) => ({ ...base, borderRadius: 8, border: '1px solid #E5E7EB', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }),
};

function BankFactsDisplay({ bankFacts }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef(null);
  const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window;

  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setPopoverOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e) => { if (e.key === 'Escape') setPopoverOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [popoverOpen]);

  const fmtM   = (v) => v != null ? `$${(parseFloat(v) / 1000).toFixed(1)}B` : '—';
  const fmtPct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

  if (!bankFacts) {
    return (
      <div style={{ marginBottom: 12, padding: '8px 10px', background: '#EFF6FF',
        border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 13, color: '#9CA3AF' }}>
        Fetching bank metrics from SEC EDGAR…
      </div>
    );
  }

  const tbv = fmtM(bankFacts.tangibleBookValue);
  const cet1 = fmtPct(bankFacts.cet1Ratio);
  const nie = fmtM(bankFacts.nonInterestExpense);

  const popoverFields = [
    {
      label: 'Tangible Book Value', value: fmtMoneyDual(bankFacts.tangibleBookValue),
      formula: "Stockholders’ Equity − Goodwill − Intangibles",
    },
    {
      label: 'CET1 Ratio', value: fmtPct(bankFacts.cet1Ratio),
      formula: 'Common Equity Tier 1 Capital ÷ Risk-Weighted Assets',
    },
    {
      label: 'Net Interest Income', value: fmtMoneyDual(bankFacts.netInterestIncome),
      formula: 'Interest Income − Interest Expense',
    },
    {
      label: 'Non-Interest Income', value: fmtMoneyDual(bankFacts.nonInterestIncome),
      formula: null,
    },
    {
      label: 'Non-Interest Expense', value: fmtMoneyDual(bankFacts.nonInterestExpense),
      formula: 'Used in synergy calculation: 5/8/11% × combined NIE',
    },
  ];

  return (
    <div style={{ position: 'relative', marginBottom: 12 }} ref={containerRef}>
      <div style={{
        background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
        padding: '6px 10px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 700, color: '#1E3A5F', fontSize: 12, flexShrink: 0 }}>Bank Metrics (SEC EDGAR):</span>
        <span style={{ color: '#374151' }}>TBV {tbv}</span>
        <span style={{ color: '#9CA3AF' }}>·</span>
        <span style={{ color: '#374151' }}>CET1 {cet1}</span>
        <span style={{ color: '#9CA3AF' }}>·</span>
        <span style={{ color: '#374151' }}>NIE {nie}</span>
        <button
          onMouseEnter={() => !isTouch && setPopoverOpen(true)}
          onMouseLeave={() => !isTouch && setPopoverOpen(false)}
          onClick={(e) => { e.stopPropagation(); setPopoverOpen(v => !v); }}
          aria-label="All bank metrics"
          style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '1px solid #9CA3AF', background: 'transparent',
            color: '#6B7280', fontSize: 9, fontWeight: 700,
            cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, lineHeight: 1,
          }}
        >ⓘ</button>
      </div>

      {popoverOpen && (
        <div
          onMouseEnter={() => !isTouch && setPopoverOpen(true)}
          onMouseLeave={() => !isTouch && setPopoverOpen(false)}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            width: 'min(360px, calc(100vw - 32px))',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
            Bank Metrics — SEC EDGAR
          </div>
          {popoverFields.map((field, i) => (
            <div key={field.label} style={{
              paddingBottom: 8, marginBottom: 8,
              borderBottom: i < popoverFields.length - 1 ? '1px solid #F3F4F6' : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{field.label}</span>
                <span style={{ fontSize: 12, color: '#0F2244', fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{field.value}</span>
              </div>
              {field.formula && (
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, fontStyle: 'italic' }}>{field.formula}</div>
              )}
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Source: SEC EDGAR FY2024 10-K</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TickerSelect({ onSelect, error, fetched, companyName, loading, dataSource }) {
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const debounceRef = useRef(null);

  const handleInputChange = (value, { action }) => {
    if (action !== 'input-change') return;
    setInputValue(value);
    clearTimeout(debounceRef.current);
    if (!value) { setOptions([]); setIsLoading(false); return; }
    setIsLoading(true);
    debounceRef.current = setTimeout(() => {
      searchTickers(value).then(results => { setOptions(results); setIsLoading(false); });
    }, 350);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && inputValue.trim() && options.length === 0) {
      e.preventDefault(); onSelect(inputValue.trim().toUpperCase()); setInputValue('');
    }
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <Select placeholder="Search company name or ticker..." options={options} isLoading={isLoading || loading}
        inputValue={inputValue} onInputChange={handleInputChange}
        onChange={(s) => { if (s) { onSelect(s.value); setInputValue(''); setOptions([]); } }}
        onKeyDown={handleKeyDown} styles={selectStyles} filterOption={() => true}
        noOptionsMessage={({ inputValue: iv }) => iv ? 'No results — press Enter to load by ticker' : 'Start typing to search...'} />
      {error && <div style={{ color: '#DC2626', fontSize: 12, marginTop: 4 }}>{error}</div>}
      {!fetched && <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>Or press Enter to load by ticker directly.</div>}
      {fetched && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#16A34A', fontSize: 13, fontWeight: 'bold' }}>
            ✓ {companyName} loaded
            {dataSource && dataSource !== 'none' && (
              <span style={{ fontWeight: 'normal', fontSize: 11, color: '#9CA3AF', marginLeft: 6,
                background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: 4, padding: '1px 5px' }}>
                via {SOURCE_LABEL[dataSource] || dataSource}
              </span>
            )}
          </div>
          {dataSource === 'none' && (
            <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6,
              padding: '6px 10px', marginTop: 6, fontSize: 12, color: '#92400E' }}>
              ⚠️ No financial data found. Enter figures manually below.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SearchIcon = () => (
  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#0F2244" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  </div>
);

const PencilIcon = () => (
  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#0F2244" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  </div>
);

// ── Default state ─────────────────────────────────────────────────────────────

const defaultInputs = {
  companyARevenue: 0, companyAEBITDA: 0, companyANetIncome: 0, companyAOperatingIncome: 0, companyAGrossProfit: null,
  companyAShares: 0, companyADilutedShares: 0, companyAEPS: 0, companyACash: 0, companyASti: null, companyADebt: 0,
  companyABsAsOf: null, companyABsBasis: null, companyALtmRevenue: null,
  currentSharePriceA: 0,
  companyAPrivate: false, companyATotalEquity: 0,   // Phase 7 — private company: no market data, equity value entered directly
  companyAValuationMultiple: 0,   // Phase 9 — EV/EBITDA multiple (peer-median pre-fill, user-editable) for a private company
  companyAValuationPin: null,      // Phase 9 — pinned peer median { sic, sector, median, asOf, n, source, peers } so a saved deal reproduces
  companyBRevenue: 0, companyBEBITDA: 0, companyBNetIncome: 0, companyBOperatingIncome: 0, companyBGrossProfit: null,
  companyBShares: 0, companyBDilutedShares: 0, companyBEPS: 0, companyBCash: 0, companyBSti: null, companyBDebt: 0,
  companyBBsAsOf: null, companyBBsBasis: null, companyBLtmRevenue: null,
  currentSharePriceB: 0,
  companyBPrivate: false, companyBTotalEquity: 0,   // Phase 7 — private company: no market data, equity value entered directly
  companyBValuationMultiple: 0,   // Phase 9 — EV/EBITDA multiple (peer-median pre-fill, user-editable) for a private company
  companyBValuationPin: null,      // Phase 9 — pinned peer median { sic, sector, median, asOf, n, source, peers } so a saved deal reproduces
  offerPricePerShare: 0, offerValueTotal: 0, cashPercent: 60,   // offerValueTotal ($M): total consideration for a PRIVATE target (no per-share price)
  // Null is empty: no synergy assumed, shown "none entered". synergiesY* are the COST synergies, revenueSynergiesY* the
  // revenue synergies. lib/synergies is the one place that turns these into figures.
  synergiesY1: null, synergiesY2: null, synergiesY3: null,
  revenueSynergiesY1: null, revenueSynergiesY2: null, revenueSynergiesY3: null,
  // Stage 2E — min operating cash the pro-forma co retains, as a % of pro-forma LTM revenue (scaled default,
  // user-overridable). Drives the sources-of-funds construction in dealCalc (excess cash funds part of the deal).
  minCashPct: MIN_CASH_PCT_DEFAULT,
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;

  const [mode, setMode] = useState(null);
  const [dealType, setDealType] = useState(null);   // Phase 9 — 'pubpub' | 'pubpriv' | 'privpriv'; derives each side's public/private + hasMarketData
  const [offerValueTouched, setOfferValueTouched] = useState(false);
  const [inputs, setInputs] = useState(defaultInputs);
  const [results, setResults] = useState(null);
  const [analysisRun, setAnalysisRun] = useState(false);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [fetchedA, setFetchedA] = useState(false);
  const [fetchedB, setFetchedB] = useState(false);
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');
  const [tickerA, setTickerA] = useState('');
  const [tickerB, setTickerB] = useState('');
  const [companyTypeA, setCompanyTypeA] = useState('standard');
  const [companyTypeB, setCompanyTypeB] = useState('standard');
  const [dataSrcA, setDataSrcA] = useState('');
  const [dataSrcB, setDataSrcB] = useState('');
  const [sicA, setSicA] = useState(null);
  const [sicB, setSicB] = useState(null);
  const [sicDescriptionA, setSicDescriptionA] = useState(null);
  const [sicDescriptionB, setSicDescriptionB] = useState(null);
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [screenView, setScreenView] = useState(false);   // 7G: no-deal Screening view (separate path, never sets results)
  const [bankFactsA, setBankFactsA] = useState(null);
  const [bankFactsB, setBankFactsB] = useState(null);
  const [priceStatusA, setPriceStatusA] = useState({ loading: false, price: null, source: null, attempts: [], asOf: null });
  const [priceStatusB, setPriceStatusB] = useState({ loading: false, price: null, source: null, attempts: [], asOf: null });
  const [offerPriceTouched, setOfferPriceTouched] = useState(false);
  const [cashPercentTouched, setCashPercentTouched] = useState(false);
  const [expandedA, setExpandedA] = useState(false);
  const [expandedB, setExpandedB] = useState(false);
  const [quoteA, setQuoteA] = useState(null);   // the /quote payload behind each card; the basis toggle reads from it
  const [quoteB, setQuoteB] = useState(null);
  const [fiscalYearA, setFiscalYearA] = useState(null);   // e.g. 2025
  const [fiscalYearEndA, setFiscalYearEndA] = useState(null);
  const [fiscalYearB, setFiscalYearB] = useState(null);
  const [fiscalYearEndB, setFiscalYearEndB] = useState(null);
  // Reported annual non-GAAP payloads from /api/nongaap. A = acquirer, B = target.
  const [nonGaapA, setNonGaapA] = useState(null);
  const [nonGaapB, setNonGaapB] = useState(null);
  // Per-company non-GAAP fetch status — disambiguates "still in flight" (wait) from "settled, no usable
  // result" (build on GAAP). nonGaapX === null is ambiguous on its own (covers both); these don't.
  const [nonGaapLoadingA, setNonGaapLoadingA] = useState(false);
  const [nonGaapLoadingB, setNonGaapLoadingB] = useState(false);
  // Wait-then-build (#5): when Build is clicked while a non-GAAP fetch is still in flight, defer the
  // build (show a "resolving basis" state) until both settle, so the deck never paints the wrong basis.
  const [pendingBuild, setPendingBuild] = useState(false);
  const pendingInputsRef = useRef(null);                 // effectiveInputs snapshot captured at click
  // "useLatest" mirror so the deferred/timeout build always reads the freshest non-GAAP, never a stale closure.
  const nonGaapRef = useRef({ a: null, b: null });
  nonGaapRef.current = { a: nonGaapA, b: nonGaapB };
  // Basis-resolved inputs the deck reads + the deal's EPS basis label.
  const [resolvedInputs, setResolvedInputs] = useState(null);
  const [accretionBasis, setAccretionBasis] = useState('GAAP');
  // GAAP | Non-GAAP toggle on the input page. null = the default (Non-GAAP when a figure is available).
  const [basisChoice, setBasisChoice] = useState(null);
  const basisChoiceRef = useRef(null);
  basisChoiceRef.current = basisChoice;
  const loadingRef = useRef({ a: false, b: false });
  loadingRef.current = { a: nonGaapLoadingA, b: nonGaapLoadingB };
  // The plan the last build used (src/lib/reportingBasis.js); the deck reads it on a Non-GAAP deal.
  const [reportingPlan, setReportingPlan] = useState(null);
  const [gaapInputs, setGaapInputs] = useState(null);   // Non-GAAP deals only: the deal's inputs on GAAP (peer screen)
  // Phase 5 — upload/extract state per panel. ADDITIVE: the ticker and manual paths below are unchanged.
  const [uploadA, setUploadA] = useState(null);   // /api/extract result: { fields, docFacts, located }
  const [uploadB, setUploadB] = useState(null);
  const [uploadingA, setUploadingA] = useState(false);
  const [uploadingB, setUploadingB] = useState(false);
  const [uploadErrA, setUploadErrA] = useState('');
  const [uploadErrB, setUploadErrB] = useState('');
  const [docFactsA, setDocFactsA] = useState(null);
  const [docFactsB, setDocFactsB] = useState(null);
  const [overrideA, setOverrideA] = useState({});  // form-field name -> user edited a pre-filled value
  const [overrideB, setOverrideB] = useState({});
  // Phase 9 — private valuation: sector classification from the uploaded filing, and the resolved peer-median
  // EV/EBITDA (or an honest failure). The multiple itself lives in inputs (editable + override-tracked).
  const [classA, setClassA] = useState(null);          // { sector, sic, confidence, rationale } | null
  const [classB, setClassB] = useState(null);
  const [valuationA, setValuationA] = useState(null);  // /api/private-comps result { ok, median, peers, n, source, note, asOf } | null
  const [valuationB, setValuationB] = useState(null);
  const [altValuationA, setAltValuationA] = useState(null);  // top-alternative sector's median — for the ambiguity comparison
  const [altValuationB, setAltValuationB] = useState(null);
  const [sectorSicA, setSectorSicA] = useState(null);  // user-selected sector SIC (dropdown); null → use the classified sector
  const [sectorSicB, setSectorSicB] = useState(null);
  const [sectorList, setSectorList] = useState([]);    // { sector, sic }[] from /api/sectors — the editable dropdown options

  const handleChange = (e) => setInputs(prev => ({ ...prev, [e.target.name]: parseFloat(e.target.value) || 0 }));
  // Phase 5 — wrap a field's onChange to also mark it a user override (so its page cite becomes "user override").
  const changeWithOverride = (panel) => (e) => { (panel === 'A' ? setOverrideA : setOverrideB)(o => ({ ...o, [e.target.name]: true })); handleChange(e); };

  // Phase 5 — POST a 10-K PDF to /api/extract and pre-fill the panel's six fields (converted to $M). A
  // missing field keeps its current value (never forced to 0); its cite shows "not found — enter manually".
  const handleExtract = (file, panel) => {
    const setUploading = panel === 'A' ? setUploadingA : setUploadingB;
    const setUpload    = panel === 'A' ? setUploadA : setUploadB;
    const setErr       = panel === 'A' ? setUploadErrA : setUploadErrB;
    const setDocFacts  = panel === 'A' ? setDocFactsA : setDocFactsB;
    const setOverride  = panel === 'A' ? setOverrideA : setOverrideB;
    const setClass     = panel === 'A' ? setClassA : setClassB;
    setUploading(true); setErr('');
    const fd = new FormData(); fd.append('file', file);
    // Shared-secret header for the upload gate (production only; unset in dev → gate is open). Baked into
    // the build via REACT_APP_UPLOAD_TOKEN; must equal the server's UPLOAD_SHARED_SECRET. Not real auth.
    const uploadToken = process.env.REACT_APP_UPLOAD_TOKEN;
    fetch(apiUrl('/api/extract'), { method: 'POST', body: fd, headers: uploadToken ? { 'x-upload-token': uploadToken } : undefined })
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j || !j.ok) { setErr((j && j.error) || 'Extraction failed.'); setUploading(false); return; }
        setUpload(j); setDocFacts(j.docFacts); setOverride({}); setClass(j.classification || null);
        const f = j.fields, P = panel, toM = v => v == null ? null : Math.round(v / 1e6);
        const ebitM = toM(f.ebit.value), daM = toM(f.da.value);
        const ebitdaM = (ebitM != null && daM != null) ? ebitM + daM : ebitM;   // EBITDA = operating income + D&A
        setInputs(prev => ({ ...prev,
          [`company${P}Revenue`]:         toM(f.revenue.value)   ?? prev[`company${P}Revenue`],
          [`company${P}OperatingIncome`]: ebitM                  ?? prev[`company${P}OperatingIncome`],
          [`company${P}EBITDA`]:          ebitdaM                ?? prev[`company${P}EBITDA`],
          [`company${P}NetIncome`]:       toM(f.netIncome.value) ?? prev[`company${P}NetIncome`],
          [`company${P}Cash`]:            toM(f.cash.value)      ?? prev[`company${P}Cash`],
          [`company${P}Debt`]:            toM(f.totalDebt.value) ?? prev[`company${P}Debt`],
        }));
        setUploading(false);
      })
      .catch(e => { setErr('Upload failed: ' + e.message); setUploading(false); });
  };
  // Phase 5 — a panel's six required fields are present. Uploaded → all six extracted; else the manual
  // path is unchanged in kind (a real entry has revenue + EBITDA). Gates the Manual-Entry Build button.
  const sixReady = (upload, P) => {
    if (upload && upload.fields) return ['revenue', 'ebit', 'da', 'netIncome', 'cash', 'totalDebt'].every(k => upload.fields[k] && upload.fields[k].value != null);
    return inputs[`company${P}Revenue`] > 0 && inputs[`company${P}EBITDA`] > 0;
  };
  // Phase 9 — the sector list for the editable dropdown (one source: the classifier's own SECTORS).
  useEffect(() => {
    fetch(apiUrl('/api/sectors')).then(r => r.json()).then(j => { if (j && j.ok) setSectorList(j.sectors || []); }).catch(() => {});
  }, []);

  // Phase 9 — resolve a private company's peer-median EV/EBITDA. The sector is the user's DROPDOWN choice
  // (sectorSicX) when set, else the classified top sector. The multiple is pre-filled from the median; the
  // median + as-of are PINNED into inputs so a saved deal reproduces. The top-alternative sector's median is
  // also resolved (display only) so the panel can show what each sector would imply. No confident sector, or
  // a peer set too thin, surfaces an honest failure — the user enters a multiple. There is NO default multiple.
  useEffect(() => {
    let cancelled = false;
    const fetchComps = (sic, sectorLabel) =>
      fetch(apiUrl(`/api/private-comps?sic=${encodeURIComponent(sic)}&sector=${encodeURIComponent(sectorLabel || '')}`)).then(x => x.json()).catch(() => null);
    const resolve = async (P, isPrivate, cls, selectedSic, override, setVal, setAltVal) => {
      if (!isPrivate || !cls) { setVal(null); setAltVal(null); return; }   // not private, or no uploaded filing → manual multiple only
      const sic = selectedSic || cls.sic;
      if (!sic) { setVal({ ok: false, sector: cls.sector, note: `No peer set for the classified sector "${cls.sector}".` }); setAltVal(null); return; }
      const explicitSwitch = selectedSic != null;   // user picked a sector in the dropdown → always refill the multiple
      try {
        const r = await fetchComps(sic, cls.sector);
        if (cancelled) return;
        setVal(r);
        if (r && r.ok) {
          setInputs(prev => {
            const next = { ...prev, [`company${P}ValuationPin`]: { sic: r.sic, sector: r.sector, median: r.median, asOf: r.asOf, n: r.n, source: r.source, peers: r.peers } };
            const mk = `company${P}ValuationMultiple`;
            // Refill the multiple on an explicit sector switch, or on the first resolve when it is still empty;
            // NEVER clobber a user-edited (override) or a saved/loaded (>0) multiple. Keeps a saved deal exact.
            if (!override[mk] && (explicitSwitch || !(parseFloat(prev[mk]) > 0))) next[mk] = r.median;
            return next;
          });
        }
        // top-alternative sector's median — for the "what each would imply" comparison (display only)
        const alt = (cls.alternatives || [])[0];
        if (alt && alt.sic) { const a = await fetchComps(alt.sic, alt.sector); if (!cancelled) setAltVal(a && a.ok ? { ...a, sector: alt.sector } : null); }
        else setAltVal(null);
      } catch (e) { if (!cancelled) { setVal({ ok: false, note: `Peer lookup failed: ${e.message}` }); setAltVal(null); } }
    };
    resolve('A', inputs.companyAPrivate, classA, sectorSicA, overrideA, setValuationA, setAltValuationA);
    resolve('B', inputs.companyBPrivate, classB, sectorSicB, overrideB, setValuationB, setAltValuationB);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.companyAPrivate, inputs.companyBPrivate, classA, classB, sectorSicA, sectorSicB]);

  // Phase 9 — user switches the sector on a private panel: re-resolve peers for that sector and refill the
  // multiple from its median (clears any prior multiple override, since a sector switch is an explicit choice).
  const handleSectorChange = (P) => (sic) => {
    (P === 'A' ? setOverrideA : setOverrideB)(o => ({ ...o, [`company${P}ValuationMultiple`]: false }));
    (P === 'A' ? setSectorSicA : setSectorSicB)(sic || null);
  };

  const handleOfferPriceChange = (e) => { setOfferPriceTouched(true); setPremiumAnchor(null); handleChange(e); };
  // The one basis switch: the card's figures are rewritten from its /quote payload. Edits made under "Edit financials" do not survive a switch.
  const handleBasisChange = (P) => (basis) => {
    const quote = P === 'A' ? quoteA : quoteB;
    if (quote) setInputs(prev => ({ ...prev, ...companyInputs(P, quote, basis) }));
  };
  const handleSynergyChange = (name, value) => setInputs(prev => ({ ...prev, [name]: value }));
  const CLEAR_SYNERGIES = { synergiesY1: null, synergiesY2: null, synergiesY3: null, revenueSynergiesY1: null, revenueSynergiesY2: null, revenueSynergiesY3: null };

  // One source of truth: inputs.offerPricePerShare. The slider writes it; the premium is derived from it.
  const spotB = liveSpot(inputs.currentSharePriceB);
  // Price basis: "Today's price" (default) or "Price on a date", read through to that day's close. A
  // weekend or holiday resolves to the previous trading day's close, which carries its own date.
  const [priceBasis, setPriceBasis] = useState(PRICE_BASIS_TODAY);
  const [unaffectedDate, setUnaffectedDate] = useState('');
  const [unaffected, setUnaffected] = useState({ close: null, date: null, reason: null, loading: false });
  useEffect(() => {
    if (!unaffectedDate || !tickerB) { setUnaffected({ close: null, date: null, reason: null, loading: false }); return undefined; }
    let cancelled = false;
    setUnaffected({ close: null, date: null, reason: null, loading: true });
    fetchCloseOn(tickerB, unaffectedDate).then(r => { if (!cancelled) setUnaffected({ ...r, loading: false }); });
    return () => { cancelled = true; };
  }, [unaffectedDate, tickerB]);
  // The one reference price: the slider, the offer, the implied premium, the tiles and the deck all read it.
  const reference = premiumReference({ basis: priceBasis, spot: spotB, beforeClose: unaffected.close });
  const refB = reference.price;
  // The premium last set with the slider or a preset. While it stands, a new reference price re-strikes the offer
  // at the same premium; a typed offer clears it, and the offer then stays as typed.
  const [premiumAnchor, setPremiumAnchor] = useState(null);
  // The offer box may still hold focus (Safari keeps it on a slider or button click), and a focused box does
  // not resync. Release it so the box always shows the stored offer.
  const setOfferFromPremium = (pct) => {
    const offer = offerFromPremium(refB, pct);
    if (offer == null) return;
    if (document.activeElement && document.activeElement.name === 'offerPricePerShare') document.activeElement.blur();
    setOfferPriceTouched(true);
    setPremiumAnchor(pct);
    setInputs(prev => ({ ...prev, offerPricePerShare: offer }));
  };
  useEffect(() => {
    if (!offerPriceTouched || premiumAnchor == null) return;
    const offer = offerFromPremium(refB, premiumAnchor);
    if (offer != null) setInputs(prev => ({ ...prev, offerPricePerShare: offer }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refB]);
  // Forward consensus for the Year 2 premium solve, from the same cached /api/pnl fetch slide 8 reads.
  const [fwdPnl, setFwdPnl] = useState({ a: null, b: null, loading: false });
  useEffect(() => {
    if (!tickerA || !tickerB) { setFwdPnl({ a: null, b: null, loading: false }); return undefined; }
    let cancelled = false;
    setFwdPnl({ a: null, b: null, loading: true });
    Promise.all([pnlFetch(tickerA), pnlFetch(tickerB)]).then(([a, b]) => { if (!cancelled) setFwdPnl({ a, b, loading: false }); });
    return () => { cancelled = true; };
  }, [tickerA, tickerB]);
  // Default premium. Applies only while the user has not set an offer, and only with a live price: without one
  // the offer stays empty and manual. A price is never defaulted from anything else.
  useEffect(() => {
    if (dealType !== 'pubpub' || offerPriceTouched) return;
    const offer = offerFromPremium(refB, DEFAULT_PREMIUM_PCT);
    if (offer != null) setInputs(prev => ({ ...prev, offerPricePerShare: offer }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealType, refB, offerPriceTouched]);

  // Auto-set cash% default when bank mode activates/deactivates
  useEffect(() => {
    if (fetchedA && fetchedB) {
      const isBankMode = companyTypeA === 'financial' && companyTypeB === 'financial';
      setInputs(prev => ({ ...prev, cashPercent: isBankMode ? 80 : 60 }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyTypeA, companyTypeB, fetchedA, fetchedB]);

  const handleSelectA = (symbol) => {
    setLoadingA(true); setErrorA(''); setBankFactsA(null); setNonGaapA(null); setNonGaapLoadingA(true);
    setPriceStatusA({ loading: true, price: null, source: null, attempts: [] });
    setInputs(prev => ({ ...prev, currentSharePriceA: 0 })); // clear stale price; live fetch resets it
    fetchCompanyData(symbol).then(data => {
      setNameA(data.name); setTickerA(symbol.toUpperCase());
      setCompanyTypeA(data.companyType || 'standard'); setDataSrcA(data.dataSource || '');
      setSicA(data.sic || null); setSicDescriptionA(data.sicDescription || null);
      setFiscalYearA(data.fiscalYear ?? null); setFiscalYearEndA(data.fiscalYearEnd ?? null);
      setQuoteA(data);
      setInputs(prev => ({ ...prev, companyAName: symbol.toUpperCase(), companyADataSource: data.dataSource ?? null,
        ...companyInputs('A', data, BASIS_FY),   // figures on the card's basis; a new company starts on Fiscal year
        companyAShares: data.shares,
        companyACash: data.cash, companyASti: data.shortTermInvestments ?? null, companyADebt: data.debt,
        companyABsAsOf: data.balanceSheetAsOf ?? null, companyABsBasis: data.balanceSheetBasis ?? null,
        companyALtmRevenue: data.ltm?.trusted ? data.ltm.revenue : null,   // LTM (not FY) — min-cash basis
        // Don't clobber a live price that the parallel /api/price fetch may have already set.
        // EDGAR (the acquirer's primary source) returns no sharePrice, so falling back to `|| 0`
        // here would overwrite the live price and force the EPS×15 proxy (0 new shares bug).
        currentSharePriceA: data.sharePrice || prev.currentSharePriceA || 0 }));
      setFetchedA(true); setLoadingA(false);
      if (isFinancial(data)) { // OBJECT → SIC fallback: banks /quote tags 'standard' (JPM/BAC) still get bank facts
        getBankFacts(symbol).then(facts => { if (facts) setBankFactsA(facts); });
      }
    }).catch(() => { setErrorA('Could not load company. Try another.'); setLoadingA(false); setPriceStatusA(p => ({ ...p, loading: false })); });

    // Live price fetch runs in parallel — EDGAR (the acquirer's primary source) does NOT return a
    // share price, so without this the acquirer price is 0 and no new shares can be issued.
    fetchLivePrice(symbol).then(({ price, source, attempts }) => {
      if (price != null) {
        setInputs(prev => ({ ...prev, currentSharePriceA: price }));
      }
      setPriceStatusA({ loading: false, price, source, attempts, asOf: price != null ? new Date() : null });
    }).catch(() => {
      setPriceStatusA({ loading: false, price: null, source: null, attempts: [], asOf: null });
    });

    // Reported non-GAAP (display layer) runs in parallel and never blocks the deck — null on failure.
    fetchNonGaap(symbol).then(setNonGaapA).catch(() => setNonGaapA(null)).finally(() => setNonGaapLoadingA(false));
  };

  const handleSelectB = (symbol) => {
    setLoadingB(true); setErrorB(''); setBankFactsB(null); setNonGaapB(null); setNonGaapLoadingB(true);
    setPriceStatusB({ loading: true, price: null, source: null, attempts: [] });
    setOfferPriceTouched(false); setPremiumAnchor(null);   // a new target starts over: its offer must not carry the last target's price
    setUnaffectedDate(''); setPriceBasis(PRICE_BASIS_TODAY);
    // Clear the stale price (the live fetch resets it) and the synergies: their presets were struck on the old target.
    setInputs(prev => ({ ...prev, currentSharePriceB: 0, offerPricePerShare: 0, ...CLEAR_SYNERGIES }));
    fetchCompanyData(symbol).then(data => {
      setNameB(data.name); setTickerB(symbol.toUpperCase());
      setCompanyTypeB(data.companyType || 'standard'); setDataSrcB(data.dataSource || '');
      setSicB(data.sic || null); setSicDescriptionB(data.sicDescription || null);
      setFiscalYearB(data.fiscalYear ?? null); setFiscalYearEndB(data.fiscalYearEnd ?? null);
      setQuoteB(data);
      setInputs(prev => ({ ...prev, companyBName: symbol.toUpperCase(), companyBDataSource: data.dataSource ?? null,
        ...companyInputs('B', data, BASIS_FY),   // figures on the card's basis; a new company starts on Fiscal year
        companyBShares: data.shares,
        companyBCash: data.cash, companyBSti: data.shortTermInvestments ?? null, companyBDebt: data.debt,
        companyBBsAsOf: data.balanceSheetAsOf ?? null, companyBBsBasis: data.balanceSheetBasis ?? null,
        companyBLtmRevenue: data.ltm?.trusted ? data.ltm.revenue : null,   // LTM (not FY) — min-cash basis
        // Preserve any live price already set by the parallel /api/price fetch (see handleSelectA).
        currentSharePriceB: data.sharePrice || prev.currentSharePriceB || 0 }));
      setFetchedB(true); setLoadingB(false);
      if (isFinancial(data)) { // OBJECT → SIC fallback: banks /quote tags 'standard' (JPM/BAC) still get bank facts
        getBankFacts(symbol).then(facts => { if (facts) setBankFactsB(facts); });
      }
    }).catch(() => { setErrorB('Could not load company. Try another.'); setLoadingB(false); setPriceStatusB(p => ({ ...p, loading: false })); });

    // Live price fetch runs in parallel — updates currentSharePriceB when it resolves
    fetchLivePrice(symbol).then(({ price, source, attempts, quoteAsOf, retrievedAt }) => {
      if (price != null) {
        setInputs(prev => ({ ...prev, currentSharePriceB: price }));
      }
      setPriceStatusB({ loading: false, price, source, attempts, asOf: price != null ? new Date() : null, quoteAsOf, retrievedAt });
    }).catch(() => {
      setPriceStatusB({ loading: false, price: null, source: null, attempts: [], asOf: null });
    });

    // Reported non-GAAP (display layer) runs in parallel and never blocks the deck — null on failure.
    fetchNonGaap(symbol).then(setNonGaapB).catch(() => setNonGaapB(null)).finally(() => setNonGaapLoadingB(false));
  };

  // Ensures exactly one build per pending cycle (settle vs timeout race; React strict-mode re-invokes).
  const buildingRef = useRef(false);

  // Whether the toggle may offer Non-GAAP, from the freshest lookups.
  const basisAvailability = (effectiveInputs) => nonGaapAvailability({
    ngA: nonGaapRef.current.a, ngB: nonGaapRef.current.b, loadingA: loadingRef.current.a, loadingB: loadingRef.current.b,
    tickerA, tickerB, privateA: !!effectiveInputs.companyAPrivate, privateB: !!effectiveInputs.companyBPrivate,
  });
  // Build the deck once on the basis-resolved inputs; the wait-then-build effects below control WHEN it runs
  // (after the non-GAAP fetches settle). Reads the freshest non-GAAP via the ref.
  // The inputs the deal model runs on. The build and the input page's live figures both come through here.
  const modelInputs = (effectiveInputs) => {
    // The one basis switch: the toggle's choice → a plan (EPS both-or-neither, EBITDA per company, LTM → "—").
    const selected = effectiveBasis(basisChoiceRef.current, basisAvailability(effectiveInputs));
    const plan = resolveReportingBasis({ selected, ngA: nonGaapRef.current.a, ngB: nonGaapRef.current.b, inputs: effectiveInputs, tickerA, tickerB });
    const calcInputs = applyReportingBasis(effectiveInputs, plan);
    const basis = plan.eps.nonGaap ? 'Non-GAAP' : 'GAAP';
    // Guard 1 (Stage 2E): tag the resolved inputs with the deck's isBankDeal (SIC-based, catches JPM/BAC) so
    // dealCalc's sources-of-funds construction — and every sensitivity cell that shares it — keeps bank deals
    // on today's 100%-debt behavior. Bank classification is read here, never modified.
    const bankDeal = isBankDeal({ companyType: companyTypeB, sic: sicB }, { companyType: companyTypeA, sic: sicA });
    // applySourcesOfFunds opts THIS deal into the sources-of-funds construction; §2's peer-impact column resets
    // it to false (no per-peer balance sheet), so only the main deal (§8/§9/§10/§11) nets combined cash.
    // A chosen price on a date is the premium reference for the deal model (dealCalc.targetMarketPrice).
    // On today's price nothing is added, so the inputs are exactly what they were.
    const ref = reference.beforeNews ? { premiumReferencePrice: reference.price, premiumReferenceDate: unaffected.date } : {};
    // gaapWithBank: the same inputs on GAAP, for views whose other legs only exist on GAAP (the peer screen).
    return { resolvedWithBank: { ...calcInputs, bankDeal, applySourcesOfFunds: true, ...ref }, gaapWithBank: { ...effectiveInputs, bankDeal, applySourcesOfFunds: true, ...ref }, basis, plan };
  };

  const runBuild = (effectiveInputs) => {
    const { resolvedWithBank, gaapWithBank, basis, plan } = modelInputs(effectiveInputs);
    const r = calculate(resolvedWithBank);
    r.basis = basis;
    // Phase 7 — carry the private-company flags so §8 suppresses market-data sections. A private company
    // has no shares/price; its equity value is the entered Total Equity Value (hasMarketData:false).
    r.hasMarketDataA = !effectiveInputs.companyAPrivate;
    r.hasMarketDataB = !effectiveInputs.companyBPrivate;
    // Phase 9 — a private company's equity value is DERIVED: peer-median (editable) EV/EBITDA × EBITDA −
    // net debt (total debt − cash). Null-honest: an absent multiple or EBITDA leaves it null (renders "—").
    const valEquity = (P) => {
      if (!effectiveInputs[`company${P}Private`]) return null;
      const mult = parseFloat(effectiveInputs[`company${P}ValuationMultiple`]) || null;
      const eb = parseFloat(effectiveInputs[`company${P}EBITDA`]);
      const dbt = parseFloat(effectiveInputs[`company${P}Debt`]);
      const csh = parseFloat(effectiveInputs[`company${P}Cash`]);
      const ev = (mult > 0 && Number.isFinite(eb)) ? mult * eb : null;
      const nd = (Number.isFinite(dbt) && Number.isFinite(csh)) ? dbt - csh : null;
      return (ev != null && nd != null) ? ev - nd : null;
    };
    r.totalEquityA = valEquity('A');
    r.totalEquityB = valEquity('B');
    setResults(r);
    setResolvedInputs(resolvedWithBank);
    setAccretionBasis(basis);
    setReportingPlan(plan);
    setGaapInputs(plan.selected === NON_GAAP ? gaapWithBank : null);
    setAnalysisRun(true);
  };

  // Deferred build (no-flicker path): fire once BOTH non-GAAP fetches have SETTLED (neither still
  // loading) while a build is pending. The deck is held in the "resolving basis" state until then, so it
  // is built exactly once on the final basis — never GAAP-then-jump.
  useEffect(() => {
    if (pendingBuild && !nonGaapLoadingA && !nonGaapLoadingB && !buildingRef.current) {
      buildingRef.current = true;
      runBuild(pendingInputsRef.current);
      setPendingBuild(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBuild, nonGaapLoadingA, nonGaapLoadingB]);

  // Timeout backstop: a hung fetch must never block the build forever. After BASIS_WAIT_TIMEOUT_MS,
  // build on whatever has settled (a lookup still in flight counts as unavailable → GAAP).
  useEffect(() => {
    if (!pendingBuild) return undefined;
    const t = setTimeout(() => {
      if (buildingRef.current) return;
      buildingRef.current = true;
      runBuild(pendingInputsRef.current);
      setPendingBuild(false);
    }, BASIS_WAIT_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBuild]);

  const handleSubmit = () => {
    const effectiveInputs = inputs;
    // Wait-then-build (#5): the accretion basis must be decided on the FINAL non-GAAP values, not a
    // cold-cache snapshot. If either selected company's non-GAAP fetch is still in flight, defer — stash
    // the inputs and show the "resolving basis" state; the settle/timeout effects above run the build
    // once both settle. Warm cache: neither is loading → build immediately (unchanged behavior).
    pendingInputsRef.current = effectiveInputs;
    if (nonGaapLoadingA || nonGaapLoadingB) {
      buildingRef.current = false;
      setPendingBuild(true);
      return;
    }
    runBuild(effectiveInputs);
  };

  const handleEditInputs = () => setAnalysisRun(false);

  const handleReset = () => {
    setInputs(defaultInputs); setResults(null); setMode(null); setDealType(null); setAnalysisRun(false);
    setOfferValueTouched(false);
    setClassA(null); setClassB(null); setValuationA(null); setValuationB(null);
    setAltValuationA(null); setAltValuationB(null); setSectorSicA(null); setSectorSicB(null);
    setUploadA(null); setUploadB(null); setDocFactsA(null); setDocFactsB(null); setOverrideA({}); setOverrideB({});
    setFetchedA(false); setFetchedB(false);
    setNameA(''); setNameB(''); setTickerA(''); setTickerB('');
    setErrorA(''); setErrorB('');
    setCompanyTypeA('standard'); setCompanyTypeB('standard');
    setDataSrcA(''); setDataSrcB('');
    setSicA(null); setSicB(null); setSicDescriptionA(null); setSicDescriptionB(null);
    setBankFactsA(null); setBankFactsB(null);
    setPriceStatusA({ loading: false, price: null, source: null, attempts: [] });
    setPriceStatusB({ loading: false, price: null, source: null, attempts: [] });
    setOfferPriceTouched(false); setCashPercentTouched(false); setUnaffectedDate(''); setPriceBasis(PRICE_BASIS_TODAY); setPremiumAnchor(null);
    setExpandedA(false); setExpandedB(false);
    setFiscalYearA(null); setFiscalYearEndA(null); setQuoteA(null); setQuoteB(null);
    setFiscalYearB(null); setFiscalYearEndB(null);
    setNonGaapA(null); setNonGaapB(null);
    setNonGaapLoadingA(false); setNonGaapLoadingB(false);
    setPendingBuild(false); buildingRef.current = false;
    setResolvedInputs(null); setAccretionBasis('GAAP');
    setBasisChoice(null); setReportingPlan(null); setGaapInputs(null);
  };

  const handleSaveAnalysis = () => {
    setSavedAnalyses(prev => [{
      id: Date.now(),
      nameA: nameA || 'Company A',
      nameB: nameB || 'Company B',
      tickerA, tickerB,
      companyTypeA, companyTypeB,
      results, inputs, mode, dealType, fetchedA, fetchedB, quoteA, quoteB,
      bankFactsA, bankFactsB,
      savedAt: new Date().toLocaleDateString(),
    }, ...prev]);
  };

  const handleLoadAnalysis = (saved) => {
    setOfferPriceTouched(true);   // a saved deal keeps its own offer
    setInputs(saved.inputs); setResults(saved.results); setQuoteA(saved.quoteA || null); setQuoteB(saved.quoteB || null);
    setNameA(saved.nameA); setNameB(saved.nameB);
    setTickerA(saved.tickerA || ''); setTickerB(saved.tickerB || '');
    // Restore the deal type (derive from the saved private flags for pre-deal-type saves), and route the
    // input screen to the unified entry view (the old 'auto'/'manual' modes were replaced by 'entry').
    const dt = saved.dealType || (saved.inputs?.companyAPrivate ? 'privpriv' : (saved.inputs?.companyBPrivate ? 'pubpriv' : 'pubpub'));
    setDealType(dt); setMode('entry');
    setCompanyTypeA(saved.companyTypeA || 'standard'); setCompanyTypeB(saved.companyTypeB || 'standard');
    setFetchedA(saved.fetchedA ?? true); setFetchedB(saved.fetchedB ?? true);
    setBankFactsA(saved.bankFactsA || null); setBankFactsB(saved.bankFactsB || null);
    setShowSaved(false);
    setAnalysisRun(true);
  };

  const handleDeleteAnalysis = (id) => setSavedAnalyses(prev => prev.filter(a => a.id !== id));

  // ── Deck data builders ───────────────────────────────────────────────────────

  // Phase 8 (§16) — per-company provenance for every required figure: the page cite + verbatim label the
  // extractor recorded from the uploaded 10-K, or "user override" / "user input" when typed. Threaded to
  // §16 (Data Verification) so a private/manual deck still shows an auditable trail for each number.
  const buildProvenance = (P) => {
    const upload   = P === 'A' ? uploadA : uploadB;
    const override = P === 'A' ? overrideA : overrideB;
    const docFacts = P === 'A' ? docFactsA : docFactsB;
    const map = [
      ['Revenue',          `company${P}Revenue`,         'revenue'],
      ['Operating income', `company${P}OperatingIncome`, 'ebit'],
      ['D&A',              null,                          'da'],
      ['Net income',       `company${P}NetIncome`,       'netIncome'],
      ['Cash',             `company${P}Cash`,            'cash'],
      ['Total debt',       `company${P}Debt`,            'totalDebt'],
    ];
    const rows = map.map(([label, inputName, key]) => {
      const uf = upload && upload.fields ? upload.fields[key] : null;
      if (inputName && override[inputName]) return { label, valueM: inputs[inputName], page: null, verbatimLabel: null, source: 'user override' };
      if (uf && uf.value != null) return { label, valueM: Math.round(uf.value / 1e6), page: uf.page, verbatimLabel: uf.label, source: uf.status === 'review' ? 'review' : 'extracted' };
      return { label, valueM: inputName ? inputs[inputName] : null, page: null, verbatimLabel: null, source: 'user input' };
    });
    return { rows, docFacts, hasUpload: !!(upload && upload.fields) };
  };

  // Phase 9 — private valuation: peer-median (editable) EV/EBITDA × EBITDA − net debt = equity value. Every
  // input is an extracted, page-cited figure (EBITDA, total debt, cash) or a user entry; the multiple is the
  // peer median or, when the peer set was too thin, a user entry. Returns nulls (→ "—") when the multiple or
  // EBITDA is absent — never a fabricated equity value. Only meaningful for a private company (else null).
  const computeValuation = (P) => {
    if (!inputs[`company${P}Private`]) return null;
    const val = P === 'A' ? valuationA : valuationB;
    const cls = P === 'A' ? classA : classB;
    const pin = inputs[`company${P}ValuationPin`] || null;   // saved/pinned peer median (survives save→load)
    const override = P === 'A' ? overrideA : overrideB;
    const multiple = parseFloat(inputs[`company${P}ValuationMultiple`]) || null;
    const ebitda = parseFloat(inputs[`company${P}EBITDA`]);
    const debt = parseFloat(inputs[`company${P}Debt`]);
    const cash = parseFloat(inputs[`company${P}Cash`]);
    const ev = (multiple > 0 && Number.isFinite(ebitda)) ? multiple * ebitda : null;
    // Net debt = total debt − cash. The debt figure is the extractor's total-debt line (the debtConcepts
    // resolver's incl-current-maturities definition, sourced to a page cite); cash likewise. Both null → null.
    const netDebt = (Number.isFinite(debt) && Number.isFinite(cash)) ? debt - cash : null;
    const equityValue = (ev != null && netDebt != null) ? ev - netDebt : null;
    // Provenance source: the live peer result if present, else the pin (so a reloaded deal keeps its median/as-of).
    const src = (val && val.ok && val.peers && val.peers.length) ? val : pin;
    const peersResolved = !!(src && src.peers && src.peers.length);
    const multipleSource = override[`company${P}ValuationMultiple`] ? 'user' : (peersResolved ? 'peer-median' : (multiple ? 'user' : null));
    return {
      sector: (src && src.sector) || (cls && cls.sector) || null,
      sic: (src && src.sic) || (cls && cls.sic) || null,
      confidence: cls ? cls.confidence : null,
      multiple, multipleSource,
      ebitda: Number.isFinite(ebitda) ? ebitda : null,
      ev, netDebt, equityValue,
      peersResolved,
      peers: peersResolved ? src.peers : [],
      n: peersResolved ? src.n : 0,
      peerMedian: src ? (src.median ?? null) : null,
      peerSource: src ? (src.source ?? null) : null,
      asOf: src ? (src.asOf ?? null) : null,   // pinned as-of date for the median
      peerNote: val ? val.note : null,
    };
  };

  const buildTargetForDeck = () => ({
    name: nameB || 'Target Company', ticker: tickerB, provenance: buildProvenance('B'), valuation: computeValuation('B'),
    sic: sicB, sicDescription: sicDescriptionB,
    revenue: inputs.companyBRevenue, ebitda: inputs.companyBEBITDA,
    grossProfit: inputs.companyBGrossProfit, operatingIncome: inputs.companyBOperatingIncome,
    freeCashFlow: inputs.companyBFreeCashFlow ?? null,
    netIncome: inputs.companyBNetIncome, eps: inputs.companyBEPS,
    shares: inputs.companyBShares, cash: inputs.companyBCash, sti: inputs.companyBSti,
    sharesLabel: quoteB?.sharesLabel ?? null,
    // Source of a filed $0 debt, or why debt is "—". Carried only while the card still shows the /quote figure (an edit drops it).
    debtLabel:  quoteB && inputs.companyBDebt === quoteB.debt ? (quoteB.debtLabel ?? null) : null,
    debtReason: quoteB && inputs.companyBDebt == null && quoteB.debt == null ? (quoteB.debtReason ?? null) : null,   // "Class A + Class B, cover of 10-Q filed …" for a class-summed cover
    balanceSheetAsOf: inputs.companyBBsAsOf, balanceSheetBasis: inputs.companyBBsBasis,
    debt: inputs.companyBDebt, companyType: companyTypeB,
    sharePrice: inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null,
    // Current market cap = live price × shares (real). Used for trading profile / relative contribution.
    // Guard BOTH operands (Stage 16): a null share count × price is 0, same fabrication as a null price.
    currentMarketCap: inputs.currentSharePriceB > 0 && inputs.companyBShares > 0 ? inputs.currentSharePriceB * inputs.companyBShares : null,
    // `marketCap` is the effective acquisition price being paid (basis for bank P/TBV).
    marketCap: (() => {
      const tpp = results ? parseFloat(results.totalPurchasePrice) : 0;
      if (tpp > 0) return tpp;                                                    // effective acquisition price (basis for bank P/TBV, comment above)
      if (inputs.currentSharePriceB > 0 && inputs.companyBShares > 0) return inputs.currentSharePriceB * inputs.companyBShares;  // real trading cap
      return null;  // no acquisition price and no live price → absent (was: companyBEPS × 15 proxy). Consumers must render "—", not fabricate.
    })(),
    // Bank-specific fields (null for non-financial companies)
    tangibleBookValue: bankFactsB?.tangibleBookValue ?? null,
    netInterestIncome: bankFactsB?.netInterestIncome ?? null,
    nonInterestIncome: bankFactsB?.nonInterestIncome ?? null,
    nonInterestExpense: bankFactsB?.nonInterestExpense ?? null,
    cet1Ratio:         bankFactsB?.cet1Ratio ?? null,
    riskWeightedAssets: bankFactsB?.riskWeightedAssets ?? null,
    totalAssets:        bankFactsB?.totalAssets ?? null,
    totalDeposits:      bankFactsB?.totalDeposits ?? null,
    basis:         inputs.companyBBasis ?? null,
    basisLabel:    inputs.companyBPeriodLabel ?? null,
    fiscalYear:    fiscalYearB,
    fiscalYearEnd: fiscalYearEndB,
    // Company-reported annual non-GAAP payload (/api/nongaap). Which figures the deal uses is in deal.reportingBasis.
    nonGaap: nonGaapB,
  });

  const buildAcquirerForDeck = () => ({
    name: nameA || 'Acquirer', ticker: tickerA, provenance: buildProvenance('A'), valuation: computeValuation('A'),
    sic: sicA, sicDescription: sicDescriptionA,
    revenue: inputs.companyARevenue, ebitda: inputs.companyAEBITDA,
    grossProfit: inputs.companyAGrossProfit, operatingIncome: inputs.companyAOperatingIncome,
    freeCashFlow: inputs.companyAFreeCashFlow ?? null,
    netIncome: inputs.companyANetIncome, eps: inputs.companyAEPS,
    shares: inputs.companyAShares, cash: inputs.companyACash, sti: inputs.companyASti,
    sharesLabel: quoteA?.sharesLabel ?? null,
    // Source of a filed $0 debt, or why debt is "—". Carried only while the card still shows the /quote figure (an edit drops it).
    debtLabel:  quoteA && inputs.companyADebt === quoteA.debt ? (quoteA.debtLabel ?? null) : null,
    debtReason: quoteA && inputs.companyADebt == null && quoteA.debt == null ? (quoteA.debtReason ?? null) : null,   // "Class A + Class B, cover of 10-Q filed …" for a class-summed cover
    balanceSheetAsOf: inputs.companyABsAsOf, balanceSheetBasis: inputs.companyABsBasis,
    debt: inputs.companyADebt, companyType: companyTypeA,
    sharePrice: inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA : null,
    // Real (live) market cap = live price × shares; null when no live price. Guard BOTH operands
    // (Stage 16): a null share count × price is 0 — the same fabrication as a null price.
    currentMarketCap: inputs.currentSharePriceA > 0 && inputs.companyAShares > 0 ? inputs.currentSharePriceA * inputs.companyAShares : null,
    // marketCap = live price × shares; null when either is absent (was the EPS×15 proxy).
    marketCap: inputs.currentSharePriceA > 0 && inputs.companyAShares > 0 ? inputs.currentSharePriceA * inputs.companyAShares : null,
    tangibleBookValue: bankFactsA?.tangibleBookValue ?? null,
    netInterestIncome: bankFactsA?.netInterestIncome ?? null,
    nonInterestIncome: bankFactsA?.nonInterestIncome ?? null,
    nonInterestExpense: bankFactsA?.nonInterestExpense ?? null,
    cet1Ratio:         bankFactsA?.cet1Ratio ?? null,
    riskWeightedAssets: bankFactsA?.riskWeightedAssets ?? null,
    totalAssets:        bankFactsA?.totalAssets ?? null,
    totalDeposits:      bankFactsA?.totalDeposits ?? null,
    basis:         inputs.companyABasis ?? null,
    basisLabel:    inputs.companyAPeriodLabel ?? null,
    fiscalYear:    fiscalYearA,
    fiscalYearEnd: fiscalYearEndA,
    // Company-reported annual non-GAAP payload (/api/nongaap). Which figures the deal uses is in deal.reportingBasis.
    nonGaap: nonGaapA,
  });

  const numOrNull = (v) => (v == null ? null : parseFloat(v));   // a null combined figure stays null, never NaN
  const buildDealForDeck = () => ({
    offerPrice: inputs.offerPricePerShare, cashPercent: inputs.cashPercent,
    // Phase 8 — false when either company is private (no market data) → DeckShell suppresses the
    // market-data exhibits and renumbers. Public/public deals keep hasMarketData true (unchanged).
    hasMarketData: results ? (results.hasMarketDataA !== false && results.hasMarketDataB !== false) : true,
    // When the price the premium is struck against was a LIVE quote, carry its fetch timestamp so the
    // football-field footnote can cite "live market price as of [date]" (explains run-to-run drift).
    offerPriceAsOf: priceStatusB.asOf ? priceStatusB.asOf.toISOString() : null,
    totalPrice:      results ? parseFloat(results.totalPurchasePrice) : 0,
    // Total EBITDA impact per year (what the accretion engine takes), plus the full schedule for the slides' lines.
    synergiesY1: synergySchedule(resolvedInputs || inputs).years[0].ebitda,
    synergiesY2: synergySchedule(resolvedInputs || inputs).years[1].ebitda,
    synergiesY3: synergySchedule(resolvedInputs || inputs).years[2].ebitda,
    synergies:   synergySchedule(resolvedInputs || inputs),
    proFormaRevenue: results ? results.proFormaRevenue : null,
    combination: combination(resolvedInputs || inputs),
    epsAccretion:    results ? parseFloat(results.epsChangePct) : 0,
    isAccretive:     results ? results.isAccretive : false,
    purchasePremium: results ? parseFloat(results.purchasePremium) : 0,
    proFormaEPS:     results ? numOrNull(results.proFormaEPS) : 0,
    evEBITDA:        results ? results.evEBITDA   : 'N/A',
    peRatio:         results ? results.peRatio    : 'N/A',
    debtEBITDA:      results ? results.debtEBITDA : 'N/A',
    dealSize:        results ? parseFloat(results.totalPurchasePrice) : 0,
    combinedRevenue: results ? numOrNull(results.combinedRevenue) : 0,
    combinedEBITDA:  results ? numOrNull(results.combinedEBITDA) : 0,
    combinedNetIncome: results ? numOrNull(results.combinedNetIncome) : 0,
    newSharesIssued: results ? parseFloat(results.newSharesIssued) : 0,
    // The deal's EPS basis label (Non-GAAP only when both companies report adjusted EPS and Non-GAAP is selected).
    basis: (results && results.basis) || accretionBasis,
    // The GAAP | Non-GAAP plan, only on a Non-GAAP deal (a GAAP deal's deal object is unchanged).
    ...(reportingPlan && reportingPlan.selected === NON_GAAP ? { reportingBasis: reportingPlan, _inputsGaap: gaapInputs } : {}),
    // Dashboard section reads these directly. _inputs carries the BASIS-RESOLVED inputs so the deck's
    // own sensitivity helpers (calcProFormaEPS / acquirerStandaloneEPS) sit on the same basis as _results.
    _results: results,
    _inputs:  { ...(resolvedInputs || inputs) },
    _nameA:   nameA,
    _nameB:   nameB,
  });

  // ── Computed values for input screen hints ────────────────────────────────────

  const bankDeal = companyTypeA === 'financial' && companyTypeB === 'financial';

  const acquirerSharePriceForSlider = inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA : null;

  // ── Layout helpers ────────────────────────────────────────────────────────────

  const scrollToApp = () => document.getElementById('app-section').scrollIntoView({ behavior: 'smooth' });
  const btnStyle = () => ({ flex: 1, padding: '32px 24px', borderRadius: 12, border: '2px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'center' });
  const cardStyle = { background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #E5E7EB' };
  const sectionTitle = { color: '#0F2244', fontSize: 16, marginTop: 0, marginBottom: 16 };
  const col2 = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 24 };

  // ── Phase 9 — deal-type entry flow ──────────────────────────────────────────────────────────────────
  // The deal type answers "public or private?" for each side, so there is no separate "Private company"
  // checkbox (hasMarketData derives from the deal type). aPub/bPub decide which panel each side renders and
  // whether the offer is per-share (public target) or a total consideration (private target, no per-share price).
  const aPub = dealType === 'pubpub' || dealType === 'pubpriv';
  const bPub = dealType === 'pubpub';
  const chooseDealType = (dt) => {
    setDealType(dt);
    setInputs(prev => ({ ...prev, companyAPrivate: dt === 'privpriv', companyBPrivate: dt !== 'pubpub' }));
    setMode('entry');
  };
  const handleOfferValueChange = (e) => { setOfferValueTouched(true); handleChange(e); };
  const sideReady = (P, pub) => pub ? (P === 'A' ? fetchedA : fetchedB) : sixReady(P === 'A' ? uploadA : uploadB, P);
  const bothReady = sideReady('A', aPub) && sideReady('B', bPub);
  const targetEquity = (() => { const v = computeValuation('B'); return v ? v.equityValue : null; })();
  const offerSet = bPub ? inputs.offerPricePerShare > 0 : parseFloat(inputs.offerValueTotal) > 0;
  const entryDealSize = bPub
    ? (inputs.offerPricePerShare > 0 && inputs.companyBShares > 0 ? inputs.offerPricePerShare * inputs.companyBShares : 0)
    : (parseFloat(inputs.offerValueTotal) || 0);

  const backLink = (
    <button onClick={() => { setMode(null); setDealType(null); }}
      style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 }}>← Change deal type</button>
  );

  // Public side — ticker search + name confirmation + collapsible editable financials (unchanged from auto).
  const renderTickerPanel = (P) => {
    const isA = P === 'A';
    const fetched = isA ? fetchedA : fetchedB;
    const priceStatus = isA ? priceStatusA : priceStatusB;
    const expanded = isA ? expandedA : expandedB;
    const setExpanded = isA ? setExpandedA : setExpandedB;
    const companyType = isA ? companyTypeA : companyTypeB;
    const bankFacts = isA ? bankFactsA : bankFactsB;
    const quote = isA ? quoteA : quoteB;
    const ltm = ltmAvailability(quote, { bank: !!quote && isFinancial(quote) });
    return (
      <div style={cardStyle}>
        <h2 style={sectionTitle}>Company {P} — {isA ? 'Acquirer' : 'Target'}</h2>
        <TickerSelect onSelect={isA ? handleSelectA : handleSelectB} error={isA ? errorA : errorB} fetched={fetched}
          companyName={isA ? nameA : nameB} loading={isA ? loadingA : loadingB} dataSource={isA ? dataSrcA : dataSrcB} />
        {fetched && (
          <div style={{ marginTop: 10 }}>
            <CompanyBasisToggle panel={P} basis={inputs[`company${P}Basis`] || BASIS_FY} onChange={handleBasisChange(P)}
              ltmAvailable={ltm.available} ltmReason={ltm.reason} periodLabel={(isA ? dataSrcA : dataSrcB) === 'none' ? null : inputs[`company${P}PeriodLabel`]} />
            {priceStatus.loading && <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6, fontStyle: 'italic' }}>⟳ Fetching live price…</div>}
            <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Rev {fmtMoney(inputs[`company${P}Revenue`])} · {inputs[`company${P}Shares`] > 0 ? `${Number(inputs[`company${P}Shares`]).toFixed(0)}M sh` : '— sh'} · {fmtPerShare(inputs[`company${P}EPS`])} EPS · {fmtMoney(inputs[`company${P}Cash`])} cash
                  {inputs[`currentSharePrice${P}`] > 0 && <span style={{ color: '#6B7280', marginLeft: 4 }}>· {fmtPerShare(inputs[`currentSharePrice${P}`])} mkt</span>}
                </span>
                <button onClick={() => setExpanded(v => !v)} style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
                  {expanded ? 'Collapse ↑' : 'Edit financials ↓'}
                </button>
              </div>
            </div>
            {expanded && (
              <div style={{ marginTop: 4 }}>
                <LargeNumericField label="Revenue ($M)" name={`company${P}Revenue`} value={inputs[`company${P}Revenue`]} onChange={handleChange} />
                {companyType === 'financial'
                  ? <BankFactsDisplay bankFacts={bankFacts} />
                  : <LargeNumericField label="EBITDA ($M)" name={`company${P}EBITDA`} value={inputs[`company${P}EBITDA`]} onChange={handleChange} />}
                <LargeNumericField label="Net Income ($M)" name={`company${P}NetIncome`} value={inputs[`company${P}NetIncome`]} onChange={handleChange} />
                <InputField label="Shares Outstanding (M)" name={`company${P}Shares`} value={inputs[`company${P}Shares`]} onChange={handleChange} />
                <InputField label="EPS ($)" name={`company${P}EPS`} value={inputs[`company${P}EPS`]} onChange={handleChange} />
                <LargeNumericField label="Cash ($M)" name={`company${P}Cash`} value={inputs[`company${P}Cash`]} onChange={handleChange} />
                <LargeNumericField label="Total Debt ($M)" name={`company${P}Debt`} value={inputs[`company${P}Debt`]} onChange={handleChange} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Private side — upload dropzone (fast path) + six figures by hand (fallback) + the peer-median valuation.
  // No shares/EPS/share-price (a private company has none); no "Private company" checkbox (the deal type said so).
  const renderPrivatePanel = (P) => {
    const isA = P === 'A';
    const upload = isA ? uploadA : uploadB;
    const override = isA ? overrideA : overrideB;
    return (
      <div style={cardStyle}>
        <h2 style={sectionTitle}>Company {P} — {isA ? 'Acquirer' : 'Target'}</h2>
        <CompanyBasisToggle panel={P} basis={BASIS_FY} onChange={() => {}} ltmAvailable={false} ltmReason="a private company has no LTM data here" />
        <UploadZone uploading={isA ? uploadingA : uploadingB} error={isA ? uploadErrA : uploadErrB} onFile={f => handleExtract(f, P)} />
        <DocFactsPanel facts={isA ? docFactsA : docFactsB} onChange={isA ? setDocFactsA : setDocFactsB} />
        <div style={{ fontSize: 11, color: '#6B7280', margin: '0 0 12px' }}>Upload a 10-K to pre-fill every figure with a page cite — or enter the six by hand below.</div>
        <LargeNumericField label="Annual Revenue ($M)" name={`company${P}Revenue`} value={inputs[`company${P}Revenue`]} onChange={changeWithOverride(P)} placeholder="$M" />
        <ExtractCite cite={upload && upload.fields.revenue} overridden={override[`company${P}Revenue`]} />
        <LargeNumericField label="EBITDA ($M)" name={`company${P}EBITDA`} value={inputs[`company${P}EBITDA`]} onChange={changeWithOverride(P)} />
        <ExtractCite cite={ebitdaCite(upload)} overridden={override[`company${P}EBITDA`]} />
        <LargeNumericField label="Net Income ($M)" name={`company${P}NetIncome`} value={inputs[`company${P}NetIncome`]} onChange={changeWithOverride(P)} placeholder="$M" />
        <ExtractCite cite={upload && upload.fields.netIncome} overridden={override[`company${P}NetIncome`]} />
        <ValuationPanel panel={P} valuation={isA ? valuationA : valuationB} altValuation={isA ? altValuationA : altValuationB} classification={isA ? classA : classB}
          sectorList={sectorList} selectedSic={isA ? sectorSicA : sectorSicB}
          multiple={inputs[`company${P}ValuationMultiple`]} ebitda={inputs[`company${P}EBITDA`]} debt={inputs[`company${P}Debt`]} cash={inputs[`company${P}Cash`]}
          onMultipleChange={changeWithOverride(P)} onSectorChange={handleSectorChange(P)} overridden={override[`company${P}ValuationMultiple`]} />
        <LargeNumericField label="Cash on Hand ($M)" name={`company${P}Cash`} value={inputs[`company${P}Cash`]} onChange={changeWithOverride(P)} />
        <ExtractCite cite={upload && upload.fields.cash} overridden={override[`company${P}Cash`]} />
        <LargeNumericField label="Total Debt ($M)" name={`company${P}Debt`} value={inputs[`company${P}Debt`]} onChange={changeWithOverride(P)} />
        <ExtractCite cite={upload && upload.fields.totalDebt} overridden={override[`company${P}Debt`]} />
      </div>
    );
  };

  // Deal terms — offer is per-share for a public target, a total consideration for a private one (no per-share).
  const renderDealTerms = () => (
    <div style={{ ...cardStyle, border: '2px solid #0F2244' }}>
      <h2 style={sectionTitle}>Deal Terms</h2>
      {(() => {
        const avail = basisAvailability(inputs);
        const sel = effectiveBasis(basisChoice, avail);
        const plan = resolveReportingBasis({ selected: sel, ngA: nonGaapA, ngB: nonGaapB, inputs, tickerA, tickerB });
        return <ReportingBasisToggle value={sel} availability={avail} plan={plan} onChange={setBasisChoice} />;
      })()}
      {bPub ? (
        <>
          <SuggestedPremiumBox spot={refB} solve={highestAccretivePremium({
              calcInputs: modelInputs(inputs).resolvedWithBank, spot: refB,
              synergyY1: synergySchedule(inputs).years[0].ebitda,   // what the build will use
              acquirerFwd: firstForwardColumn(fwdPnl.a), targetFwd: firstForwardColumn(fwdPnl.b), pnlLoading: fwdPnl.loading,
              acquirerName: tickerA, targetName: tickerB,
            })} onUse={setOfferFromPremium} />
          <PriceTiles spot={spotB} quoteAsOf={priceStatusB.quoteAsOf} retrievedAt={priceStatusB.retrievedAt} offer={inputs.offerPricePerShare}
            basis={priceBasis} onBasis={setPriceBasis} referenceDate={unaffectedDate} onReferenceDate={setUnaffectedDate}
            beforeClose={unaffected} referencePrice={refB} />
          <PremiumSlider spot={refB} beforeNews={reference.beforeNews} offer={inputs.offerPricePerShare} loadingPrice={priceStatusB.loading} onPremiumChange={setOfferFromPremium} />
          <InputField label="Offer Price Per Share ($)" name="offerPricePerShare" value={inputs.offerPricePerShare} onChange={handleOfferPriceChange}
            format={formatOfferInput} userEntered={offerPriceTouched} placeholder="$ per share" />
        </>
      ) : (
        <>
          {targetEquity != null && (
            <SuggestionBadge primary={fmtMoneyDual(targetEquity)} caption="Derived equity value (peer-median EV/EBITDA × EBITDA − net debt)"
              onUse={() => { setOfferValueTouched(true); setInputs(prev => ({ ...prev, offerValueTotal: Math.round(targetEquity) })); }} />
          )}
          <LargeNumericField label="Offer / Total Equity Value ($M)" name="offerValueTotal" value={inputs.offerValueTotal} onChange={handleOfferValueChange} placeholder="$M" />
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 8, fontStyle: 'italic' }}>Private target — the deal is a total consideration; there is no per-share offer price.</div>
        </>
      )}
      <CashPercentageSlider value={inputs.cashPercent} userEntered={cashPercentTouched} onChange={(v) => { setCashPercentTouched(true); setInputs(prev => ({ ...prev, cashPercent: v })); }}
        tooltip={buildCashPercentTooltip(bankDeal)} dealSize={entryDealSize}
        acquirerSharePrice={acquirerSharePriceForSlider} acquirerSharesOutstanding={inputs.companyAShares} />
      {bPub && <CashFundingBox funding={acquisitionNewDebt(modelInputs(inputs).resolvedWithBank)} targetName={tickerB} />}
    </div>
  );

  const renderSynergies = () => (
    <div style={cardStyle}>
      <h2 style={sectionTitle}>Synergies (Year 1 → Year 3)</h2>
      <SynergyInputs inputs={inputs} onChange={handleSynergyChange} />
    </div>
  );

  // ── Render: wait-then-build hold state (#5) — deck is deferred until the non-GAAP basis settles, so
  //    it is never painted on the wrong basis. Auto-advances to the deck via the settle/timeout effects. ──
  if (pendingBuild) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', minHeight: '100vh', background: 'linear-gradient(160deg, #0F2244 0%, #1D4A8A 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px' }}>
        <style>{`@keyframes ngspin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 46, height: 46, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.25)', borderTopColor: '#4A9FD4', animation: 'ngspin 0.9s linear infinite', marginBottom: 24 }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 10 }}>
          Resolving reporting basis (GAAP vs non-GAAP)…
        </div>
        <div style={{ fontSize: 14, color: '#A8C4DC', maxWidth: 460, lineHeight: 1.5 }}>
          Fetching reported non-GAAP figures so the deck builds on the correct basis the first time. First load of a company can take ~15–20s; cached loads are instant.
        </div>
      </div>
    );
  }

  // ── Render: Screening view (7G) — a SEPARATE path ahead of the deal gate. It never calls calculate()
  //    and never sets results, so the deal flow below is untouched. ──────────────────────────────────
  if (screenView) {
    return <SectionScreening onBack={() => setScreenView(false)} />;
  }

  // ── Render: DeckShell when analysis has run ──────────────────────────────────

  if (analysisRun && results) {
    return (
      <DeckShell
        target={buildTargetForDeck()}
        acquirer={buildAcquirerForDeck()}
        deal={buildDealForDeck()}
        comparables={savedAnalyses}
        onEditInputs={handleEditInputs}
        onNewAnalysis={handleReset}
        onSaveAnalysis={handleSaveAnalysis}
      />
    );
  }

  // ── Render: hero + input screens ─────────────────────────────────────────────

  return (
    <div style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Hero */}
      <div style={{ height: '100vh', background: 'linear-gradient(160deg, #0F2244 0%, #1D4A8A 100%)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px', position: 'relative' }}>
        {/* Back-to-site link — anchors to the 100vh hero (scrolls off with it; the deck view is a separate return). Same tab: nothing to lose on the splash. */}
        <a href="https://easy-ma.netlify.app"
          onMouseEnter={e => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.14)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.28)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
          }}
          style={{
            position: 'absolute', top: 24, left: 24,
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '9px 18px 9px 15px',
            color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
            fontSize: 13.5, fontWeight: 600, letterSpacing: '0.01em',
            border: '1px solid rgba(255,255,255,0.28)',
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(6px)',
            transition: 'background-color .18s, border-color .18s, color .18s'
          }}>
          ← Back to site
        </a>
        <div style={{ fontSize: isMobile ? 56 : 80, fontWeight: 900, color: '#fff', letterSpacing: '-2px', lineHeight: 1, marginBottom: 24 }}>
          Easy<span style={{ color: '#4A9FD4' }}>M&A</span>
        </div>
        <div style={{ fontSize: isMobile ? 16 : 20, color: '#A8C4DC', marginBottom: 48, maxWidth: 480 }}>
          Merger analysis in minutes, not days.
        </div>
        <button onClick={scrollToApp} style={{ padding: '16px 48px', background: '#fff', color: '#0F2244',
          border: 'none', borderRadius: 50, fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
          Start Analysis ↓
        </button>
      </div>

      {/* App section */}
      <div id="app-section" style={{ background: '#F4F6F9', minHeight: '100vh', paddingTop: 48, paddingBottom: 48 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
          <div style={{ background: '#0F2244', borderRadius: 12, padding: '14px 24px', marginBottom: 32,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <a href="https://easy-ma.netlify.app" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>Easy<span style={{ color: '#4A9FD4' }}>M&A</span></div>
            </a>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button onClick={() => setScreenView(true)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 14px',
                fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                🔍 Screening
              </button>
              {savedAnalyses.length > 0 && (
                <button onClick={() => setShowSaved(true)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 14px',
                  fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                  💾 Saved ({savedAnalyses.length})
                </button>
              )}
            </div>
          </div>

          {/* Input screens */}
          {/* Phase 9 — deal-type chooser: the deal type decides how each side is entered (no separate
              public/private checkbox). Public side → ticker; private side → upload or manual. */}
          {!mode && (
            <div>
              <h2 style={{ color: '#0F2244', textAlign: 'center', marginBottom: 8 }}>What kind of deal is this?</h2>
              <p style={{ color: '#6B7280', textAlign: 'center', marginBottom: 32 }}>Pick the deal type — it decides how each side’s data is entered.</p>
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, maxWidth: 1100, margin: '0 auto' }}>
                <button style={btnStyle()} onClick={() => chooseDealType('pubpub')}>
                  <SearchIcon />
                  <div style={{ fontWeight: 'bold', fontSize: 18, color: '#0F2244', margin: '8px 0' }}>Public → Public</div>
                  <div style={{ fontSize: 14, color: '#6B7280' }}>Both are listed. Ticker lookup on both sides — everything automated.</div>
                </button>
                <button style={btnStyle()} onClick={() => chooseDealType('pubpriv')}>
                  <SearchIcon />
                  <div style={{ fontWeight: 'bold', fontSize: 18, color: '#0F2244', margin: '8px 0' }}>Public → Private</div>
                  <div style={{ fontSize: 14, color: '#6B7280' }}>Listed acquirer, private target. Ticker for the acquirer; upload or enter the target.</div>
                </button>
                <button style={btnStyle()} onClick={() => chooseDealType('privpriv')}>
                  <PencilIcon />
                  <div style={{ fontWeight: 'bold', fontSize: 18, color: '#0F2244', margin: '8px 0' }}>Private → Private</div>
                  <div style={{ fontSize: 14, color: '#6B7280' }}>Neither is listed. Upload a 10-K or enter the six figures on both sides.</div>
                </button>
              </div>
            </div>
          )}

          {/* Phase 9 — unified entry view: each side renders the panel that fits its public/private nature. */}
          {mode === 'entry' && (
            <div>
              {backLink}
              <div style={col2}>
                {aPub ? renderTickerPanel('A') : renderPrivatePanel('A')}
                {bPub ? renderTickerPanel('B') : renderPrivatePanel('B')}
              </div>
              {bothReady && (
                <>
                  <div style={col2}>
                    {renderDealTerms()}
                    {renderSynergies()}
                  </div>
                  <button onClick={handleSubmit} disabled={!(bothReady && offerSet)}
                    title={!offerSet ? (bPub ? 'Enter an offer price to build.' : 'Enter a total offer value to build.') : undefined}
                    style={{ width: '100%', padding: 16, background: (bothReady && offerSet) ? '#0F2244' : '#9CA3AF', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 'bold', cursor: (bothReady && offerSet) ? 'pointer' : 'not-allowed' }}>
                    {offerSet ? 'Run Analysis →' : (bPub ? 'Enter an offer price to build →' : 'Enter a total offer value to build →')}
                  </button>
                </>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Saved Analyses drawer */}
      {showSaved && (
        <>
          <div onClick={() => setShowSaved(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }} />
          <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: isMobile ? '100%' : 380,
            background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 101, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#0F2244', fontSize: 18 }}>Saved Analyses</h2>
              <button onClick={() => setShowSaved(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
              {savedAnalyses.length === 0 ? (
                <p style={{ color: '#9CA3AF', textAlign: 'center', marginTop: 48 }}>No saved analyses yet.</p>
              ) : savedAnalyses.map(saved => (
                <div key={saved.id} style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontWeight: 'bold', color: '#0F2244', marginBottom: 6, fontSize: 15 }}>
                    {saved.nameA} + {saved.nameB}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ background: saved.results.isAccretive ? '#DCFCE7' : '#FEE2E2', color: saved.results.isAccretive ? '#166534' : '#991B1B', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                      {saved.results.isAccretive ? '✓ Accretive' : '✗ Dilutive'}
                    </span>
                    <span style={{ background: '#F3F4F6', color: '#374151', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>
                      EPS {saved.results.isAccretive ? '+' : ''}{saved.results.epsChangePct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>Saved {saved.savedAt}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => handleLoadAnalysis(saved)} style={{ flex: 1, padding: '7px 0', background: '#0F2244', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      Load
                    </button>
                    <button onClick={() => handleDeleteAnalysis(saved.id)} style={{ padding: '7px 14px', background: '#fff', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
