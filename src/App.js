import { apiUrl } from './api';
import { useState, useRef, useEffect } from 'react';
import Select from 'react-select';
import { DeckShell } from './components/deck/DeckShell';
import { SectionScreening } from './components/deck/sections/SectionScreening';
import { calculate, MIN_CASH_PCT_DEFAULT } from './utils/dealCalc';
import { useWindowWidth } from './hooks/useWindowWidth';
import { getBankFacts } from './services/edgarBankFacts';
import { fetchLivePrice } from './services/priceService';
import { SuggestionBadge } from './components/shared/SuggestionBadge';
import { ExplainButton } from './components/shared/ExplainButton';
import { CashPercentageSlider } from './components/shared/CashPercentageSlider';
import { CollapsibleNote } from './components/shared/CollapsibleNote';
import { fmtMoneyDual, fmtMoney, fmtPerShare, isFinancial, isBankDeal } from './components/deck/shared/deckTokens';
import {
  calcSuggestedOfferPrice,
  calcSuggestedTransactionFees,
  calcAllInFeeEstimate,
  calcSuggestedSynergy,
  buildOfferPriceTooltip,
  buildCashPercentTooltip,
  buildTransactionFeesTooltip,
  buildSynergyTooltip,
} from './lib/suggestionTooltips';
import { explainPremium } from './lib/explanations';
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

// Reported annual NON-GAAP figures (operating income / net income / diluted EPS) from the fiscal
// year-end earnings 8-K, period-matched to the deck FY and code-reconciled server-side. Display layer
// only — the accretion/pro-forma math still runs off GAAP. Returns the full payload (or null on any
// failure) so the deck can fall back to GAAP and label the basis honestly; never throws.
function fetchNonGaap(symbol) {
  return fetch(apiUrl(`/api/nongaap/${symbol}`))
    .then(r => r.json())
    .catch(() => null);
}

// Wait-then-build timeout (#5): a hung non-GAAP fetch must never block the deck forever. After this,
// build on whatever has settled (resolveAccretionBasis maps a missing side → GAAP, honestly).
const BASIS_WAIT_TIMEOUT_MS = 22000;

// Human "as of" stamp for the live market price the suggested offer/premium is based on, e.g.
// "Jun 25, 2026, 2:31 PM". Explains why the suggested price drifts run-to-run (live price moves intraday).
function fmtPriceAsOf(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Accretion BASIS resolver (Step 3 flip — applied at input assembly, dealCalc helpers unchanged) ──
// When BOTH companies have a fully-reconciled non-GAAP payload (incl. the filing-sourced dilutedShares),
// override ONLY the four P&L inputs the accretion math reads — net income (both sides), and the
// acquirer's reported EPS + diluted shares — so dealCalc.calculate() runs entirely on non-GAAP. If
// EITHER side is missing/non-reconciling (e.g. any deal with Atlassian), the WHOLE deal stays on GAAP
// (never a mixed basis). All other inputs (offer, cash%, target cover shares, price, debt, synergies)
// are untouched, so financing drag and new-share dilution carry over identically. Returns {calcInputs, basis}.
function resolveAccretionBasis(baseInputs, ngA, ngB) {
  const usable = (p) => p && p.allReconciled && p.nonGaap
    && p.nonGaap.operatingIncome != null && p.nonGaap.netIncome != null
    && p.nonGaap.dilutedEPS != null && p.nonGaap.dilutedShares != null;
  if (!usable(ngA) || !usable(ngB)) return { calcInputs: baseInputs, basis: 'GAAP' };
  return {
    basis: 'Non-GAAP',
    calcInputs: {
      ...baseInputs,
      companyANetIncome:     ngA.nonGaap.netIncome,
      companyAEPS:           ngA.nonGaap.dilutedEPS,
      companyADilutedShares: ngA.nonGaap.dilutedShares,
      companyBNetIncome:     ngB.nonGaap.netIncome,
    },
  };
}

// ── UI components ─────────────────────────────────────────────────────────────

const inputBaseStyle = (disabled) => ({
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14,
  boxSizing: 'border-box', background: disabled ? '#F9FAFB' : '#fff', color: disabled ? '#9CA3AF' : 'inherit',
});

function InputField({ label, name, value, onChange, disabled, note, placeholder }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value === 0 ? '' : String(value);
    }
  }, [value]);
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: disabled ? '#9CA3AF' : '#6B7280', marginBottom: 4 }}>{label}</label>
      <input ref={inputRef} type="number" name={name} defaultValue={value === 0 ? '' : value}
        placeholder={placeholder || ''} onChange={onChange} disabled={disabled}
        style={inputBaseStyle(disabled)} />
      {note && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic' }}>{note}</div>}
    </div>
  );
}

// Large-number input — displays comma separators while keeping state as a clean number.
function LargeNumericField({ label, name, value, onChange, disabled, note, placeholder }) {
  const inputRef = useRef(null);
  const fmt = (v) => (v === 0 || v === '') ? '' : Number(v).toLocaleString('en-US');

  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = fmt(value);
    }
  }, [value]);

  const handleInput = (e) => {
    const cleaned = e.target.value.replace(/,/g, '');
    onChange({ target: { name, value: cleaned } });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: disabled ? '#9CA3AF' : '#6B7280', marginBottom: 4 }}>{label}</label>
      <input ref={inputRef} type="text" inputMode="decimal" name={name}
        defaultValue={fmt(value)} placeholder={placeholder || ''}
        onChange={handleInput} disabled={disabled}
        style={inputBaseStyle(disabled)} />
      {note && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic' }}>{note}</div>}
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

function PremiumCaption({ offerPrice, sharePrice, showUnavailable, asOf }) {
  const price = parseFloat(offerPrice) || 0;
  if (!price) return null;
  if (!sharePrice) {
    if (!showUnavailable) return null;
    return (
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' }}>
        Current price unavailable — premium cannot be computed
      </div>
    );
  }
  const premium = ((price - sharePrice) / sharePrice) * 100;
  const isNeg = premium < 0;
  const color = (isNeg || premium > 75) ? '#D62B2B'
    : (premium < 20 || premium > 50) ? '#F59E0B'
    : '#10B981';
  // Premium is computed against the LIVE market price (moves intraday) — stamp the as-of so the
  // premium's run-to-run drift is explained.
  const asOfStr = fmtPriceAsOf(asOf);
  return (
    <div style={{ fontSize: 11, color, marginTop: 4, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
      Implied premium: {premium >= 0 ? '+' : ''}{premium.toFixed(1)}%{' '}
      {isNeg ? 'below' : 'above'} live price (${parseFloat(sharePrice).toFixed(2)}){asOfStr ? ` as of ${asOfStr}` : ''}
      <ExplainButton explain={() => explainPremium({ offerPrice: price, marketPrice: sharePrice })} />
    </div>
  );
}


function PriceDiagnostic({ attempts }) {
  const SOURCE_NAMES = { fmp: 'FMP', finnhub: 'Finnhub', alphavantage: 'Alpha Vantage' };
  return (
    <div style={{ fontSize: 11, marginTop: -4, marginBottom: 8, color: '#9CA3AF' }}>
      Live price unavailable — suggestion based on EPS × P/E blend.
      {attempts.length > 0 && (
        <span style={{ marginLeft: 4 }}>
          ({attempts.map(a => `${SOURCE_NAMES[a.source] || a.source}: ${a.ok ? '✓' : '✗'}`).join(', ')})
        </span>
      )}
    </div>
  );
}


// Reference-only all-in fee breakdown shown inside the collapsible note. The MODEL uses only the
// base advisory fee; legal & financing here are rough, clearly-labeled estimates (Phase 2.4).
function AllInFeeBreakdown({ allIn }) {
  const row = (label, value, strong) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0',
      borderTop: strong ? '1.5px solid #0F2244' : '1px solid #EEF2F6' }}>
      <span style={{ color: strong ? '#0F2244' : '#6B7280', fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: strong ? 700 : 500 }}>{fmtMoney(value)}</span>
    </div>
  );
  return (
    <div>
      {row('Base advisory fee (model input)', allIn.advisorFee)}
      {row('Legal & regulatory (est.)', allIn.legalFee)}
      {row('Financing & other (est.)', allIn.otherFee)}
      {row('All-in estimate', allIn.total, true)}
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6, fontStyle: 'italic', lineHeight: 1.4 }}>
        Reference only — the model uses the base advisory fee above. Legal & financing are rough estimates.
      </div>
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
  companyBRevenue: 0, companyBEBITDA: 0, companyBNetIncome: 0, companyBOperatingIncome: 0, companyBGrossProfit: null,
  companyBShares: 0, companyBDilutedShares: 0, companyBEPS: 0, companyBCash: 0, companyBSti: null, companyBDebt: 0,
  companyBBsAsOf: null, companyBBsBasis: null, companyBLtmRevenue: null,
  currentSharePriceB: 0,
  offerPricePerShare: 0, cashPercent: 60, transactionFees: 0,
  synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
  // Stage 2E — min operating cash the pro-forma co retains, as a % of pro-forma LTM revenue (scaled default,
  // user-overridable). Drives the sources-of-funds construction in dealCalc (excess cash funds part of the deal).
  minCashPct: MIN_CASH_PCT_DEFAULT,
};

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;

  const [mode, setMode] = useState(null);
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
  const [expandedA, setExpandedA] = useState(false);
  const [expandedB, setExpandedB] = useState(false);
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
  // Basis-resolved inputs the deck reads (non-GAAP when both reconcile, else GAAP) + the basis label.
  const [resolvedInputs, setResolvedInputs] = useState(null);
  const [accretionBasis, setAccretionBasis] = useState('GAAP');

  const handleChange = (e) => setInputs(prev => ({ ...prev, [e.target.name]: parseFloat(e.target.value) || 0 }));
  const handleOfferPriceChange = (e) => { setOfferPriceTouched(true); handleChange(e); };

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
      setInputs(prev => ({ ...prev, companyARevenue: data.revenue, companyAEBITDA: data.ebitda,
        companyANetIncome: data.netIncome, companyAShares: data.shares,
        companyAOperatingIncome: data.operatingIncome, companyAGrossProfit: data.grossProfit ?? null,
        companyAFreeCashFlow: data.freeCashFlow ?? null,
        companyADilutedShares: data.dilutedShares, companyAEPS: data.eps,
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
    setInputs(prev => ({ ...prev, currentSharePriceB: 0 })); // clear stale price; live fetch resets it
    fetchCompanyData(symbol).then(data => {
      setNameB(data.name); setTickerB(symbol.toUpperCase());
      setCompanyTypeB(data.companyType || 'standard'); setDataSrcB(data.dataSource || '');
      setSicB(data.sic || null); setSicDescriptionB(data.sicDescription || null);
      setFiscalYearB(data.fiscalYear ?? null); setFiscalYearEndB(data.fiscalYearEnd ?? null);
      setInputs(prev => ({ ...prev, companyBRevenue: data.revenue, companyBEBITDA: data.ebitda,
        companyBNetIncome: data.netIncome, companyBShares: data.shares,
        companyBOperatingIncome: data.operatingIncome, companyBGrossProfit: data.grossProfit ?? null,
        companyBFreeCashFlow: data.freeCashFlow ?? null,
        companyBDilutedShares: data.dilutedShares, companyBEPS: data.eps,
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
    fetchLivePrice(symbol).then(({ price, source, attempts }) => {
      if (price != null) {
        setInputs(prev => ({ ...prev, currentSharePriceB: price }));
      }
      setPriceStatusB({ loading: false, price, source, attempts, asOf: price != null ? new Date() : null });
    }).catch(() => {
      setPriceStatusB({ loading: false, price: null, source: null, attempts: [], asOf: null });
    });

    // Reported non-GAAP (display layer) runs in parallel and never blocks the deck — null on failure.
    fetchNonGaap(symbol).then(setNonGaapB).catch(() => setNonGaapB(null)).finally(() => setNonGaapLoadingB(false));
  };

  // Ensures exactly one build per pending cycle (settle vs timeout race; React strict-mode re-invokes).
  const buildingRef = useRef(false);

  // Build the deck once on the basis-resolved inputs. resolveAccretionBasis is UNCHANGED — this only
  // controls WHEN it runs (after the non-GAAP fetches settle). Reads the freshest non-GAAP via the ref.
  const runBuild = (effectiveInputs) => {
    const { calcInputs, basis } = resolveAccretionBasis(effectiveInputs, nonGaapRef.current.a, nonGaapRef.current.b);
    // Guard 1 (Stage 2E): tag the resolved inputs with the deck's isBankDeal (SIC-based, catches JPM/BAC) so
    // dealCalc's sources-of-funds construction — and every sensitivity cell that shares it — keeps bank deals
    // on today's 100%-debt behavior. Bank classification is read here, never modified.
    const bankDeal = isBankDeal({ companyType: companyTypeB, sic: sicB }, { companyType: companyTypeA, sic: sicA });
    // applySourcesOfFunds opts THIS deal into the sources-of-funds construction; §2's peer-impact column resets
    // it to false (no per-peer balance sheet), so only the main deal (§8/§9/§10/§11) nets combined cash.
    const resolvedWithBank = { ...calcInputs, bankDeal, applySourcesOfFunds: true };
    const r = calculate(resolvedWithBank);
    r.basis = basis;
    setResults(r);
    setResolvedInputs(resolvedWithBank);
    setAccretionBasis(basis);
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
  // build on whatever has settled (resolveAccretionBasis maps a missing side → GAAP).
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
    const updates = {};
    if (inputs.offerPricePerShare === 0 && suggestedPrice != null && suggestedPrice > 0)
      updates.offerPricePerShare = suggestedPrice;
    if (inputs.synergiesY1 === 0 && synAuto1 != null && synAuto1 > 0) updates.synergiesY1 = synAuto1;
    if (inputs.synergiesY2 === 0 && synAuto2 != null && synAuto2 > 0) updates.synergiesY2 = synAuto2;
    if (inputs.synergiesY3 === 0 && synAuto3 != null && synAuto3 > 0) updates.synergiesY3 = synAuto3;
    // Fix 8 (default A): auto-apply the size-tiered suggested advisory fee on build when the user has
    // not entered one, so the model never silently reports "$0M transaction costs". Uses the effective
    // (possibly just auto-filled) offer to size the deal.
    if ((parseFloat(inputs.transactionFees) || 0) === 0) {
      const offerForFee = updates.offerPricePerShare ?? inputs.offerPricePerShare;
      const dealSizeM = offerForFee > 0 && inputs.companyBShares > 0 ? offerForFee * inputs.companyBShares : 0;
      const suggestedFee = calcSuggestedTransactionFees(dealSizeM);
      if (suggestedFee && suggestedFee > 0) updates.transactionFees = suggestedFee;
    }
    let effectiveInputs = inputs;
    if (Object.keys(updates).length > 0) {
      effectiveInputs = { ...inputs, ...updates };
      setInputs(effectiveInputs);
    }
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
    setInputs(defaultInputs); setResults(null); setMode(null); setAnalysisRun(false);
    setFetchedA(false); setFetchedB(false);
    setNameA(''); setNameB(''); setTickerA(''); setTickerB('');
    setErrorA(''); setErrorB('');
    setCompanyTypeA('standard'); setCompanyTypeB('standard');
    setDataSrcA(''); setDataSrcB('');
    setSicA(null); setSicB(null); setSicDescriptionA(null); setSicDescriptionB(null);
    setBankFactsA(null); setBankFactsB(null);
    setPriceStatusA({ loading: false, price: null, source: null, attempts: [] });
    setPriceStatusB({ loading: false, price: null, source: null, attempts: [] });
    setOfferPriceTouched(false);
    setExpandedA(false); setExpandedB(false);
    setFiscalYearA(null); setFiscalYearEndA(null);
    setFiscalYearB(null); setFiscalYearEndB(null);
    setNonGaapA(null); setNonGaapB(null);
    setNonGaapLoadingA(false); setNonGaapLoadingB(false);
    setPendingBuild(false); buildingRef.current = false;
    setResolvedInputs(null); setAccretionBasis('GAAP');
  };

  const handleSaveAnalysis = () => {
    setSavedAnalyses(prev => [{
      id: Date.now(),
      nameA: nameA || 'Company A',
      nameB: nameB || 'Company B',
      tickerA, tickerB,
      companyTypeA, companyTypeB,
      results, inputs, mode, fetchedA, fetchedB,
      bankFactsA, bankFactsB,
      savedAt: new Date().toLocaleDateString(),
    }, ...prev]);
  };

  const handleLoadAnalysis = (saved) => {
    setInputs(saved.inputs); setResults(saved.results);
    setNameA(saved.nameA); setNameB(saved.nameB);
    setTickerA(saved.tickerA || ''); setTickerB(saved.tickerB || '');
    setMode(saved.mode || 'manual');
    setCompanyTypeA(saved.companyTypeA || 'standard'); setCompanyTypeB(saved.companyTypeB || 'standard');
    setFetchedA(saved.fetchedA ?? true); setFetchedB(saved.fetchedB ?? true);
    setBankFactsA(saved.bankFactsA || null); setBankFactsB(saved.bankFactsB || null);
    setShowSaved(false);
    setAnalysisRun(true);
  };

  const handleDeleteAnalysis = (id) => setSavedAnalyses(prev => prev.filter(a => a.id !== id));

  // ── Deck data builders ───────────────────────────────────────────────────────

  const buildTargetForDeck = () => ({
    name: nameB || 'Target Company', ticker: tickerB,
    sic: sicB, sicDescription: sicDescriptionB,
    revenue: inputs.companyBRevenue, ebitda: inputs.companyBEBITDA,
    grossProfit: inputs.companyBGrossProfit, operatingIncome: inputs.companyBOperatingIncome,
    freeCashFlow: inputs.companyBFreeCashFlow ?? null,
    netIncome: inputs.companyBNetIncome, eps: inputs.companyBEPS,
    shares: inputs.companyBShares, cash: inputs.companyBCash, sti: inputs.companyBSti,
    balanceSheetAsOf: inputs.companyBBsAsOf, balanceSheetBasis: inputs.companyBBsBasis,
    debt: inputs.companyBDebt, companyType: companyTypeB,
    sharePrice: inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null,
    // Current market cap = live price × shares (real). Used for trading profile / relative contribution.
    currentMarketCap: inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB * inputs.companyBShares : null,
    // `marketCap` is the effective acquisition price being paid (basis for bank P/TBV).
    marketCap: (() => {
      const tpp = results ? parseFloat(results.totalPurchasePrice) : 0;
      return tpp > 0 ? tpp : (inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : inputs.companyBEPS * 15) * inputs.companyBShares;
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
    fiscalYear:    fiscalYearB,
    fiscalYearEnd: fiscalYearEndB,
    // Reported annual non-GAAP payload — drives the §4/§5/§6 display layer; the accretion flip reads it
    // separately at input assembly (resolveAccretionBasis), so this field stays the raw display source.
    nonGaap: nonGaapB,
  });

  const buildAcquirerForDeck = () => ({
    name: nameA || 'Acquirer', ticker: tickerA,
    sic: sicA, sicDescription: sicDescriptionA,
    revenue: inputs.companyARevenue, ebitda: inputs.companyAEBITDA,
    grossProfit: inputs.companyAGrossProfit, operatingIncome: inputs.companyAOperatingIncome,
    freeCashFlow: inputs.companyAFreeCashFlow ?? null,
    netIncome: inputs.companyANetIncome, eps: inputs.companyAEPS,
    shares: inputs.companyAShares, cash: inputs.companyACash, sti: inputs.companyASti,
    balanceSheetAsOf: inputs.companyABsAsOf, balanceSheetBasis: inputs.companyABsBasis,
    debt: inputs.companyADebt, companyType: companyTypeA,
    sharePrice: inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA : null,
    // Real (live) market cap = live price × shares; null when no live price.
    currentMarketCap: inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA * inputs.companyAShares : null,
    // marketCap = live price × shares; fall back to a P/E proxy only if no live price.
    marketCap: (inputs.currentSharePriceA > 0 ? inputs.currentSharePriceA : inputs.companyAEPS * 15) * inputs.companyAShares,
    tangibleBookValue: bankFactsA?.tangibleBookValue ?? null,
    netInterestIncome: bankFactsA?.netInterestIncome ?? null,
    nonInterestIncome: bankFactsA?.nonInterestIncome ?? null,
    nonInterestExpense: bankFactsA?.nonInterestExpense ?? null,
    cet1Ratio:         bankFactsA?.cet1Ratio ?? null,
    riskWeightedAssets: bankFactsA?.riskWeightedAssets ?? null,
    totalAssets:        bankFactsA?.totalAssets ?? null,
    totalDeposits:      bankFactsA?.totalDeposits ?? null,
    fiscalYear:    fiscalYearA,
    fiscalYearEnd: fiscalYearEndA,
    // Reported annual non-GAAP payload — drives the §4/§5/§6 display layer; the accretion flip reads it
    // separately at input assembly (resolveAccretionBasis), so this field stays the raw display source.
    nonGaap: nonGaapA,
  });

  const buildDealForDeck = () => ({
    offerPrice: inputs.offerPricePerShare, cashPercent: inputs.cashPercent,
    // When the price the premium is struck against was a LIVE quote, carry its fetch timestamp so the
    // football-field footnote can cite "live market price as of [date]" (explains run-to-run drift).
    offerPriceAsOf: priceStatusB.asOf ? priceStatusB.asOf.toISOString() : null,
    totalPrice:      results ? parseFloat(results.totalPurchasePrice) : 0,
    transactionFees: inputs.transactionFees,
    synergiesY1: inputs.synergiesY1, synergiesY2: inputs.synergiesY2, synergiesY3: inputs.synergiesY3,
    epsAccretion:    results ? parseFloat(results.epsChangePct) : 0,
    isAccretive:     results ? results.isAccretive : false,
    purchasePremium: results ? parseFloat(results.purchasePremium) : 0,
    proFormaEPS:     results ? parseFloat(results.proFormaEPS) : 0,
    evEBITDA:        results ? results.evEBITDA   : 'N/A',
    peRatio:         results ? results.peRatio    : 'N/A',
    debtEBITDA:      results ? results.debtEBITDA : 'N/A',
    lehmanFee:       inputs.transactionFees,
    dealSize:        results ? parseFloat(results.totalPurchasePrice) : 0,
    combinedRevenue: results ? parseFloat(results.combinedRevenue) : 0,
    combinedEBITDA:  results ? parseFloat(results.combinedEBITDA) : 0,
    combinedNetIncome: results ? parseFloat(results.combinedNetIncome) : 0,
    newSharesIssued: results ? parseFloat(results.newSharesIssued) : 0,
    // Accretion basis label (Non-GAAP when both companies reconcile, else GAAP).
    basis: (results && results.basis) || accretionBasis,
    // Dashboard section reads these directly. _inputs carries the BASIS-RESOLVED inputs so the deck's
    // own sensitivity helpers (calcProFormaEPS / acquirerStandaloneEPS) sit on the same basis as _results.
    _results: results,
    _inputs:  { ...(resolvedInputs || inputs) },
    _nameA:   nameA,
    _nameB:   nameB,
  });

  // ── Computed values for input screen hints ────────────────────────────────────

  const partialTarget = {
    companyType: companyTypeB,
    revenue: inputs.companyBRevenue,
    ebitda: inputs.companyBEBITDA,
    eps: inputs.companyBEPS,
    shares: inputs.companyBShares,
    sharePrice: inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null,
    nonInterestExpense: bankFactsB?.nonInterestExpense || 0,
  };
  const partialAcquirer = {
    companyType: companyTypeA,
    revenue: inputs.companyARevenue,
    nonInterestExpense: bankFactsA?.nonInterestExpense || 0,
  };

  const suggestedPrice = fetchedB ? calcSuggestedOfferPrice(partialTarget) : null;

  const bankDeal = companyTypeA === 'financial' && companyTypeB === 'financial';

  const acquirerSharePriceForSlider = inputs.currentSharePriceA > 0
    ? inputs.currentSharePriceA
    : (inputs.companyAEPS > 0 ? inputs.companyAEPS * 15 : 0);

  const dealSizeForSlider = (() => {
    const price = inputs.offerPricePerShare > 0 ? inputs.offerPricePerShare
      : (suggestedPrice > 0 ? suggestedPrice : 0);
    return price > 0 && inputs.companyBShares > 0 ? price * inputs.companyBShares : 0;
  })();

  // ── Synergy pre-computations (used in handleSubmit auto-fill)
  const synAuto1 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 1) : null;
  const synAuto2 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 2) : null;
  const synAuto3 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 3) : null;
  // ── Layout helpers ────────────────────────────────────────────────────────────

  const scrollToApp = () => document.getElementById('app-section').scrollIntoView({ behavior: 'smooth' });
  const btnStyle = () => ({ flex: 1, padding: '32px 24px', borderRadius: 12, border: '2px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'center' });
  const cardStyle = { background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #E5E7EB' };
  const sectionTitle = { color: '#0F2244', fontSize: 16, marginTop: 0, marginBottom: 16 };
  const col2 = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 24 };

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
          onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,1)'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
          style={{ position: 'absolute', top: 24, left: 24, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 14, fontWeight: 500, letterSpacing: '0.01em' }}>
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
          {!mode && (
            <div>
              <h2 style={{ color: '#0F2244', textAlign: 'center', marginBottom: 8 }}>How would you like to enter company data?</h2>
              <p style={{ color: '#6B7280', textAlign: 'center', marginBottom: 32 }}>Choose auto-lookup to pull real financials, or enter numbers manually.</p>
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, maxWidth: 1000, margin: '0 auto' }}>
                <button style={btnStyle()} onClick={() => setMode('auto')}>
                  <SearchIcon />
                  <div style={{ fontWeight: 'bold', fontSize: 18, color: '#0F2244', marginBottom: 8 }}>Auto-Lookup</div>
                  <div style={{ fontSize: 14, color: '#6B7280' }}>Search by company name or ticker and we pull the financials automatically.</div>
                </button>
                <button style={btnStyle()} onClick={() => setMode('manual')}>
                  <PencilIcon />
                  <div style={{ fontWeight: 'bold', fontSize: 18, color: '#0F2244', marginBottom: 8 }}>Manual Entry</div>
                  <div style={{ fontSize: 14, color: '#6B7280' }}>Enter the financial data yourself. Good for private companies or custom scenarios.</div>
                </button>
              </div>
            </div>
          )}

          {mode === 'auto' && (
            <div>
              {/* ── Two company panels (collapsed by default) ─────────────── */}
              <div style={col2}>
                {/* Panel A — Acquirer */}
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company A — Acquirer</h2>
                  <TickerSelect onSelect={handleSelectA} error={errorA} fetched={fetchedA}
                    companyName={nameA} loading={loadingA} dataSource={dataSrcA} />
                  {fetchedA && (
                    <div style={{ marginTop: 10 }}>
                      {priceStatusA.loading && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6, fontStyle: 'italic' }}>⟳ Fetching live price…</div>
                      )}
                      {/* Summary line */}
                      <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Rev {fmtMoney(inputs.companyARevenue)} · {inputs.companyAShares > 0 ? `${Number(inputs.companyAShares).toFixed(0)}M sh` : '— sh'} · {fmtPerShare(inputs.companyAEPS)} EPS · {fmtMoney(inputs.companyACash)} cash
                            {inputs.currentSharePriceA > 0 && (
                              <span style={{ color: '#6B7280', marginLeft: 4 }}>· {fmtPerShare(inputs.currentSharePriceA)} mkt</span>
                            )}
                          </span>
                          <button onClick={() => setExpandedA(v => !v)}
                            style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
                            {expandedA ? 'Collapse ↑' : 'Edit financials ↓'}
                          </button>
                        </div>
                      </div>
                      {/* Editable fields */}
                      {expandedA && (
                        <div style={{ marginTop: 4 }}>
                          <LargeNumericField label="Revenue ($M)" name="companyARevenue" value={inputs.companyARevenue} onChange={handleChange} />
                          {companyTypeA === 'financial'
                            ? <BankFactsDisplay bankFacts={bankFactsA} />
                            : <LargeNumericField label="EBITDA ($M)" name="companyAEBITDA" value={inputs.companyAEBITDA} onChange={handleChange} />
                          }
                          <LargeNumericField label="Net Income ($M)" name="companyANetIncome" value={inputs.companyANetIncome} onChange={handleChange} />
                          <InputField label="Shares Outstanding (M)" name="companyAShares" value={inputs.companyAShares} onChange={handleChange} />
                          <InputField label="EPS ($)" name="companyAEPS" value={inputs.companyAEPS} onChange={handleChange} />
                          <LargeNumericField label="Cash ($M)" name="companyACash" value={inputs.companyACash} onChange={handleChange} />
                          <LargeNumericField label="Total Debt ($M)" name="companyADebt" value={inputs.companyADebt} onChange={handleChange} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Panel B — Target */}
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company B — Target</h2>
                  <TickerSelect onSelect={handleSelectB} error={errorB} fetched={fetchedB}
                    companyName={nameB} loading={loadingB} dataSource={dataSrcB} />
                  {fetchedB && (
                    <div style={{ marginTop: 10 }}>
                      {priceStatusB.loading && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6, fontStyle: 'italic' }}>⟳ Fetching live price…</div>
                      )}
                      {/* Summary line */}
                      <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            Rev {fmtMoney(inputs.companyBRevenue)} · {inputs.companyBShares > 0 ? `${Number(inputs.companyBShares).toFixed(0)}M sh` : '— sh'} · {fmtPerShare(inputs.companyBEPS)} EPS · {fmtMoney(inputs.companyBCash)} cash
                            {inputs.currentSharePriceB > 0 && (
                              <span style={{ color: '#6B7280', marginLeft: 4 }}>· {fmtPerShare(inputs.currentSharePriceB)} mkt</span>
                            )}
                          </span>
                          <button onClick={() => setExpandedB(v => !v)}
                            style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0, flexShrink: 0 }}>
                            {expandedB ? 'Collapse ↑' : 'Edit financials ↓'}
                          </button>
                        </div>
                      </div>
                      {/* Editable fields */}
                      {expandedB && (
                        <div style={{ marginTop: 4 }}>
                          <LargeNumericField label="Revenue ($M)" name="companyBRevenue" value={inputs.companyBRevenue} onChange={handleChange} />
                          {companyTypeB === 'financial'
                            ? <BankFactsDisplay bankFacts={bankFactsB} />
                            : <LargeNumericField label="EBITDA ($M)" name="companyBEBITDA" value={inputs.companyBEBITDA} onChange={handleChange} />
                          }
                          <LargeNumericField label="Net Income ($M)" name="companyBNetIncome" value={inputs.companyBNetIncome} onChange={handleChange} />
                          <InputField label="Shares Outstanding (M)" name="companyBShares" value={inputs.companyBShares} onChange={handleChange} />
                          <InputField label="EPS ($)" name="companyBEPS" value={inputs.companyBEPS} onChange={handleChange} />
                          <LargeNumericField label="Cash ($M)" name="companyBCash" value={inputs.companyBCash} onChange={handleChange} />
                          <LargeNumericField label="Total Debt ($M)" name="companyBDebt" value={inputs.companyBDebt} onChange={handleChange} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Deal terms + synergies (shown once both loaded) ────────── */}
              {fetchedA && fetchedB && (
                <>
                  <div style={col2}>
                    {/* ── Deal Terms Hero (2px navy border) ──────────────── */}
                    <div style={{ ...cardStyle, border: '2px solid #0F2244' }}>
                      <h2 style={sectionTitle}>Deal Terms</h2>

                      {/* Offer price suggestion */}
                      {suggestedPrice != null && suggestedPrice > 0 && (() => {
                        const sp = inputs.currentSharePriceB;
                        const prem = sp > 0 ? Math.round(((suggestedPrice - sp) / sp) * 100) : null;
                        // The suggested price is a 30% premium over the LIVE market price (which moves
                        // intraday) — label the as-of stamp so its run-to-run drift is explained, not mysterious.
                        const asOf = fmtPriceAsOf(priceStatusB.asOf);
                        return (
                          <SuggestionBadge
                            primary={prem != null
                              ? `${fmtPerShare(suggestedPrice)}/share (${prem}% premium)`
                              : `${fmtPerShare(suggestedPrice)}/share`}
                            caption={sp > 0
                              ? `30% control premium over ${fmtPerShare(sp)} live market price${asOf ? ` · as of ${asOf}` : ''}`
                              : null}
                            tooltip={buildOfferPriceTooltip(partialTarget)}
                            onUse={() => setInputs(prev => ({ ...prev, offerPricePerShare: suggestedPrice }))}
                          />
                        );
                      })()}
                      {!priceStatusB.loading && inputs.currentSharePriceB === 0 && priceStatusB.attempts.length > 0 && (
                        <PriceDiagnostic attempts={priceStatusB.attempts} />
                      )}

                      {/* Offer price input */}
                      <InputField label="Offer Price Per Share ($)" name="offerPricePerShare"
                        value={inputs.offerPricePerShare} onChange={handleOfferPriceChange}
                        placeholder={suggestedPrice > 0 ? `e.g., ${fmtPerShare(suggestedPrice)}` : 'e.g., 128.08'} />
                      {inputs.offerPricePerShare > 0 && (
                        <PremiumCaption offerPrice={inputs.offerPricePerShare}
                          sharePrice={inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null}
                          showUnavailable={offerPriceTouched} asOf={priceStatusB.asOf} />
                      )}

                      {/* Cash/Stock mix */}
                      <CashPercentageSlider
                        value={inputs.cashPercent}
                        onChange={(v) => setInputs(prev => ({ ...prev, cashPercent: v }))}
                        tooltip={buildCashPercentTooltip(bankDeal)}
                        dealSize={dealSizeForSlider}
                        acquirerSharePrice={acquirerSharePriceForSlider}
                        acquirerSharesOutstanding={inputs.companyAShares}
                      />

                      {/* Advisory fee */}
                      <div style={{ margin: '16px 0', borderTop: '1px solid #E5E7EB' }} />
                      {(() => {
                        const price = inputs.offerPricePerShare > 0 ? inputs.offerPricePerShare : (suggestedPrice ?? 0);
                        const dealSizeM = price > 0 && inputs.companyBShares > 0 ? price * inputs.companyBShares : 0;
                        const fee = calcSuggestedTransactionFees(dealSizeM);
                        if (!fee) return (
                          <SuggestionBadge label="Enter offer price to estimate base advisory fee"
                            tooltip={buildTransactionFeesTooltip(0, bankDeal)} />
                        );
                        return (
                          <SuggestionBadge
                            primary={fmtMoneyDual(fee)}
                            caption="Base advisory fee only — legal &amp; regulatory are additional"
                            tooltip={buildTransactionFeesTooltip(dealSizeM, bankDeal)}
                            onUse={() => setInputs(prev => ({ ...prev, transactionFees: fee }))}
                          />
                        );
                      })()}
                      <LargeNumericField label="Transaction Fees — Base Advisory ($M)"
                        name="transactionFees" value={inputs.transactionFees} onChange={handleChange}
                        placeholder="Base advisory fee only" />
                      {/* Stage 2E — min cash the pro-forma co retains (% of PF LTM revenue). Combined cash above it
                          funds part of the deal, cutting new debt vs the 100%-debt assumption. User-overridable. */}
                      <InputField label="Min Cash of PF Co (% of pro-forma LTM revenue)"
                        name="minCashPct"
                        value={inputs.minCashPct != null ? +(inputs.minCashPct * 100).toFixed(2) : +(MIN_CASH_PCT_DEFAULT * 100).toFixed(2)}
                        onChange={(e) => { const p = parseFloat(e.target.value); setInputs(prev => ({ ...prev, minCashPct: Number.isFinite(p) ? p / 100 : MIN_CASH_PCT_DEFAULT })); }}
                        note="Combined cash above this retained minimum funds part of the deal (excess cash used); banks keep the 100%-debt convention." />
                      {(() => {
                        const price = inputs.offerPricePerShare > 0 ? inputs.offerPricePerShare : (suggestedPrice ?? 0);
                        const dealSizeM = price > 0 && inputs.companyBShares > 0 ? price * inputs.companyBShares : 0;
                        const allIn = calcAllInFeeEstimate(dealSizeM);
                        if (!allIn) return null;
                        return (
                          <CollapsibleNote label="All-in estimate (reference only)">
                            <AllInFeeBreakdown allIn={allIn} />
                          </CollapsibleNote>
                        );
                      })()}
                    </div>

                    {/* ── Synergies with preset buttons ───────────────────── */}
                    <div style={cardStyle}>
                      <h2 style={sectionTitle}>{bankDeal ? 'Cost Takeouts (Year 1 → Year 3)' : 'Synergies (Year 1 → Year 3)'}</h2>

                      {/* Preset buttons */}
                      {(() => {
                        const targetBase = bankDeal
                          ? (bankFactsB?.nonInterestExpense || 0)
                          : (inputs.companyBRevenue || 0);
                        if (!(targetBase > 0)) return null;
                        const rates = bankDeal ? [0.05, 0.08, 0.11] : [0.02, 0.035, 0.05];
                        const labels = ['Conservative', 'Base', 'Aggressive'];
                        return (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>
                              Quick presets — fills all three years with a 57%/79%/100% ramp:
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {labels.map((label, idx) => {
                                const rate = rates[idx];
                                const y3 = Math.round(targetBase * rate);
                                const y2 = Math.round(y3 * 0.785);
                                const y1 = Math.round(y3 * 0.57);
                                return (
                                  <button key={label}
                                    onClick={() => setInputs(prev => ({ ...prev, synergiesY1: y1, synergiesY2: y2, synergiesY3: y3 }))}
                                    style={{
                                      flex: 1, padding: '8px 4px', borderRadius: 6,
                                      border: '1px solid #D1D5DB', background: '#F9FAFB',
                                      color: '#374151', fontSize: 12, cursor: 'pointer',
                                      fontWeight: 500, textAlign: 'center', lineHeight: 1.4,
                                    }}>
                                    {label}
                                    <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                                      {(rate * 100).toFixed(1)}% · Y3={fmtMoney(y3)}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Year 1/2/3 inputs with live % caption */}
                      {[1, 2, 3].map(yr => {
                        const name = `synergiesY${yr}`;
                        const val = inputs[name] || 0;
                        const targetBase = bankDeal ? (bankFactsB?.nonInterestExpense || 0) : (inputs.companyBRevenue || 0);
                        const pct = targetBase > 0 && val > 0 ? ((val / targetBase) * 100).toFixed(1) : null;
                        const label = bankDeal ? `Year ${yr} Cost Savings ($M)` : `Year ${yr} Synergies ($M)`;
                        return (
                          <div key={yr}>
                            <LargeNumericField label={label} name={name} value={inputs[name]} onChange={handleChange} placeholder="e.g., 935" />
                            {pct && (
                              <div style={{ fontSize: 11, color: '#6B7280', marginTop: -8, marginBottom: 8, fontStyle: 'italic' }}>
                                = {pct}% of target {bankDeal ? 'NIE' : 'revenue'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Build button — disabled until offer > 0 ─────────── */}
                  <button
                    onClick={handleSubmit}
                    disabled={inputs.offerPricePerShare === 0}
                    style={{
                      width: '100%', padding: 16, borderRadius: 10, fontSize: 16,
                      fontWeight: 'bold', border: 'none',
                      cursor: inputs.offerPricePerShare > 0 ? 'pointer' : 'not-allowed',
                      background: inputs.offerPricePerShare > 0 ? '#0F2244' : '#E5E7EB',
                      color: inputs.offerPricePerShare > 0 ? '#fff' : '#9CA3AF',
                      transition: 'background 0.15s',
                    }}
                  >
                    {inputs.offerPricePerShare > 0 ? 'Build merger model →' : 'Enter an offer price to build →'}
                  </button>
                </>
              )}
            </div>
          )}

          {mode === 'manual' && (
            <div>
              <div style={col2}>
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company A — Acquirer</h2>
                  <LargeNumericField label="Annual Revenue ($M)" name="companyARevenue" value={inputs.companyARevenue} onChange={handleChange} placeholder="Enter revenue in millions" />
                  <LargeNumericField label="EBITDA ($M)" name="companyAEBITDA" value={inputs.companyAEBITDA} onChange={handleChange} />
                  <LargeNumericField label="Net Income ($M)" name="companyANetIncome" value={inputs.companyANetIncome} onChange={handleChange} placeholder="Enter net income in millions" />
                  <InputField label="Shares Outstanding (millions)" name="companyAShares" value={inputs.companyAShares} onChange={handleChange} />
                  <InputField label="Earnings Per Share ($)" name="companyAEPS" value={inputs.companyAEPS} onChange={handleChange} />
                  <LargeNumericField label="Cash on Hand ($M)" name="companyACash" value={inputs.companyACash} onChange={handleChange} />
                  <LargeNumericField label="Total Debt ($M)" name="companyADebt" value={inputs.companyADebt} onChange={handleChange} />
                </div>
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company B — Target</h2>
                  <LargeNumericField label="Annual Revenue ($M)" name="companyBRevenue" value={inputs.companyBRevenue} onChange={handleChange} placeholder="Enter revenue in millions" />
                  <LargeNumericField label="EBITDA ($M)" name="companyBEBITDA" value={inputs.companyBEBITDA} onChange={handleChange} />
                  <LargeNumericField label="Net Income ($M)" name="companyBNetIncome" value={inputs.companyBNetIncome} onChange={handleChange} placeholder="Enter net income in millions" />
                  <InputField label="Shares Outstanding (millions)" name="companyBShares" value={inputs.companyBShares} onChange={handleChange} />
                  <InputField label="Earnings Per Share ($)" name="companyBEPS" value={inputs.companyBEPS} onChange={handleChange} />
                  <LargeNumericField label="Cash on Hand ($M)" name="companyBCash" value={inputs.companyBCash} onChange={handleChange} />
                  <LargeNumericField label="Total Debt ($M)" name="companyBDebt" value={inputs.companyBDebt} onChange={handleChange} />
                  <InputField label="Current Share Price ($) — optional, for premium calc" name="currentSharePriceB" value={inputs.currentSharePriceB} onChange={handleChange} placeholder="e.g., 749.28" />
                </div>
              </div>
              <div style={col2}>

                {/* ── Deal Terms (manual) ────────────────────────────── */}
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Deal Terms</h2>
                  <InputField label="Offer Price Per Share ($)" name="offerPricePerShare" value={inputs.offerPricePerShare} onChange={handleOfferPriceChange} placeholder="e.g., 974.06" />
                  {inputs.offerPricePerShare > 0 && (
                    <PremiumCaption offerPrice={inputs.offerPricePerShare} sharePrice={inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null} showUnavailable={offerPriceTouched} asOf={priceStatusB.asOf} />
                  )}
                  <CashPercentageSlider
                    value={inputs.cashPercent}
                    onChange={(v) => setInputs(prev => ({ ...prev, cashPercent: v }))}
                    tooltip={buildCashPercentTooltip(false)}
                    dealSize={inputs.offerPricePerShare > 0 && inputs.companyBShares > 0 ? inputs.offerPricePerShare * inputs.companyBShares : 0}
                    acquirerSharePrice={inputs.companyAEPS > 0 ? inputs.companyAEPS * 15 : 0}
                    acquirerSharesOutstanding={inputs.companyAShares}
                  />
                  {/* Divider before Transaction Fees */}
                  <div style={{ margin: '16px 0', borderTop: '1px solid #E5E7EB' }} />

                  {(() => {
                    const dealSizeM = inputs.offerPricePerShare > 0 && inputs.companyBShares > 0
                      ? inputs.offerPricePerShare * inputs.companyBShares : 0;
                    const totalFee = calcSuggestedTransactionFees(dealSizeM);
                    if (!totalFee) {
                      return (
                        <SuggestionBadge
                          label="Typical M&A fees: advisor (Lehman Formula) + legal"
                          tooltip={buildTransactionFeesTooltip(0, false)}
                        />
                      );
                    }
                    return (
                      <SuggestionBadge
                        primary={fmtMoneyDual(totalFee)}
                        tooltip={buildTransactionFeesTooltip(dealSizeM, false)}
                        onUse={() => setInputs(prev => ({ ...prev, transactionFees: totalFee }))}
                      />
                    );
                  })()}
                  <LargeNumericField label="Transaction Fees ($M)" name="transactionFees" value={inputs.transactionFees} onChange={handleChange} placeholder="e.g., 2,187" />
                </div>

                {/* ── Synergies (manual) ─────────────────────────────── */}
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Synergies (Year 1 → Year 3)</h2>
                  {(() => {
                    const manualTarget = { companyType: 'standard', revenue: inputs.companyBRevenue, nonInterestExpense: 0 };
                    const manualAcquirer = { companyType: 'standard', revenue: inputs.companyARevenue, nonInterestExpense: 0 };
                    const s1 = calcSuggestedSynergy(manualTarget, manualAcquirer, 1);
                    const s2 = calcSuggestedSynergy(manualTarget, manualAcquirer, 2);
                    const s3 = calcSuggestedSynergy(manualTarget, manualAcquirer, 3);
                    const hasManualSuggestions = s1 != null && s2 != null && s3 != null;

                    if (!hasManualSuggestions) {
                      return [1, 2, 3].map(yr => (
                        <InputField key={yr} label={`Year ${yr} Synergies ($M)`} name={`synergiesY${yr}`} value={inputs[`synergiesY${yr}`]} onChange={handleChange} placeholder="Enter synergies" />
                      ));
                    }
                    return (
                      <>
                        {[1, 2, 3].map(yr => {
                          const suggested = yr === 1 ? s1 : yr === 2 ? s2 : s3;
                          const name = `synergiesY${yr}`;
                          const pcts = ['2%', '3.5%', '5%'];
                          const caption = `Year ${yr}: ${pcts[yr - 1]} of combined revenue`;
                          return (
                            <div key={yr}>
                              {suggested != null && (
                                <SuggestionBadge
                                  primary={fmtMoneyDual(suggested)}
                                  caption={caption}
                                  tooltip={buildSynergyTooltip(manualTarget, manualAcquirer, yr)}
                                  onUse={() => setInputs(prev => ({ ...prev, [name]: suggested }))}
                                />
                              )}
                              <InputField label={`Year ${yr} Synergies ($M)`} name={name} value={inputs[name]} onChange={handleChange} placeholder="Enter synergies" />
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </div>
              <button onClick={handleSubmit} style={{ width: '100%', padding: 16, background: '#0F2244', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
                Run Analysis →
              </button>
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
