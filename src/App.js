import { useState, useRef, useEffect } from 'react';
import Select from 'react-select';
import { DeckShell } from './components/deck/DeckShell';
import { calculate } from './utils/dealCalc';
import { useWindowWidth } from './hooks/useWindowWidth';
import { getBankFacts } from './services/edgarBankFacts';
import { fetchLivePrice } from './services/priceService';
import { SuggestionBadge } from './components/shared/SuggestionBadge';
import { ExplainButton } from './components/shared/ExplainButton';
import { CashPercentageSlider } from './components/shared/CashPercentageSlider';
import { fmtMoneyDual, fmtMoney, fmtPerShare } from './components/deck/shared/deckTokens';
import {
  calcSuggestedOfferPrice,
  calcSuggestedTransactionFees,
  calcSuggestedSynergy,
  buildOfferPriceTooltip,
  buildCashPercentTooltip,
  buildTransactionFeesTooltip,
  buildSynergyTooltip,
} from './lib/suggestionTooltips';
import { explainPremium } from './lib/explanations';
import { CollapsibleNote } from './components/shared/CollapsibleNote';
import './App.css';

// ── API helpers ───────────────────────────────────────────────────────────────

function searchTickers(query) {
  return fetch(`http://localhost:3001/search?q=${query}`)
    .then(r => r.json())
    .then(data => data.map(item => ({ value: item.symbol, label: `${item.symbol} — ${item.name}` })))
    .catch(() => []);
}

function fetchCompanyData(symbol) {
  return fetch(`http://localhost:3001/quote?symbol=${symbol}`)
    .then(r => r.json())
    .then(data => { if (data.error) throw new Error(data.error); return data; });
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
  const fmtM   = (v) => v != null ? `$${parseFloat(v).toFixed(0)}M` : '—';
  const fmtPct = (v) => v != null ? `${(v * 100).toFixed(2)}%` : '—';

  if (!bankFacts) {
    return (
      <div style={{ marginBottom: 12, padding: '8px 10px', background: '#F0F9FF',
        border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 12, color: '#9CA3AF' }}>
        Fetching bank metrics from SEC EDGAR…
      </div>
    );
  }

  const rows = [
    { label: 'Tangible Book Value',    value: fmtM(bankFacts.tangibleBookValue) },
    { label: 'CET1 Ratio',             value: fmtPct(bankFacts.cet1Ratio) },
    { label: 'Net Interest Income',    value: fmtM(bankFacts.netInterestIncome) },
    { label: 'Non-Interest Income',    value: fmtM(bankFacts.nonInterestIncome) },
    { label: 'Non-Interest Expense',   value: fmtM(bankFacts.nonInterestExpense) },
  ];

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#1E3A5F', marginBottom: 4, fontWeight: 600, letterSpacing: 0.3 }}>
        Bank Metrics (SEC EDGAR)
      </div>
      <div style={{ border: '1px solid #BFDBFE', borderRadius: 6, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <div key={row.label} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '5px 10px', background: i % 2 === 0 ? '#EFF6FF' : '#F0F9FF',
            borderBottom: i < rows.length - 1 ? '1px solid #DBEAFE' : 'none',
          }}>
            <span style={{ fontSize: 11, color: '#374151' }}>{row.label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1E3A5F' }}>{row.value}</span>
          </div>
        ))}
      </div>
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

function PremiumCaption({ offerPrice, sharePrice }) {
  const price = parseFloat(offerPrice) || 0;
  if (!price) return null;
  if (!sharePrice) {
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
  return (
    <div style={{ fontSize: 11, color, marginTop: 4, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
      Implied premium: {premium >= 0 ? '+' : ''}{premium.toFixed(1)}%{' '}
      {isNeg ? 'below' : 'above'} current price (${parseFloat(sharePrice).toFixed(2)})
      <ExplainButton explain={() => explainPremium({ offerPrice: price, marketPrice: sharePrice })} />
    </div>
  );
}


function PriceDiagnostic({ attempts }) {
  const [open, setOpen] = useState(false);
  const SOURCE_NAMES = { fmp: 'FMP', finnhub: 'Finnhub', alphavantage: 'Alpha Vantage' };
  return (
    <div style={{ fontSize: 11, marginTop: -4, marginBottom: 8 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span style={{ color: '#6B7280' }}>based on EPS × P/E blend</span>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#0070D2', padding: '0 0 0 4px',
            lineHeight: 1, display: 'inline-flex', alignItems: 'center',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#004A99'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#0070D2'; }}
        >▾</button>
      </span>
      {open && (
        <div className="collapsible-content" style={{ marginTop: 4, padding: '6px 10px', background: '#F8FAFC', borderTop: '1px solid #E5E7EB', borderRadius: 4 }}>
          {attempts.length === 0
            ? <span style={{ color: '#9CA3AF' }}>No price sources configured.</span>
            : attempts.map(a => (
                <div key={a.source} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 3 }}>
                  <span style={{ color: a.ok ? '#16A34A' : '#DC2626', fontWeight: 700, flexShrink: 0 }}>{a.ok ? '✓' : '✗'}</span>
                  <span style={{ color: '#374151' }}>{SOURCE_NAMES[a.source] || a.source}</span>
                  {a.error && <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>— {a.error}</span>}
                  {!a.ok && !a.error && a.source !== 'fmp' && (
                    <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>— no data or API key not configured</span>
                  )}
                </div>
              ))
          }
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
  companyARevenue: 0, companyAEBITDA: 0, companyANetIncome: 0,
  companyAShares: 0, companyAEPS: 0, companyACash: 0, companyADebt: 0,
  currentSharePriceA: 0,
  companyBRevenue: 0, companyBEBITDA: 0, companyBNetIncome: 0,
  companyBShares: 0, companyBEPS: 0, companyBCash: 0, companyBDebt: 0,
  currentSharePriceB: 0,
  offerPricePerShare: 0, cashPercent: 60, transactionFees: 0,
  synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
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
  const [savedAnalyses, setSavedAnalyses] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [bankFactsA, setBankFactsA] = useState(null);
  const [bankFactsB, setBankFactsB] = useState(null);
  const [priceStatusB, setPriceStatusB] = useState({ loading: false, price: null, source: null, attempts: [] });

  const handleChange = (e) => setInputs(prev => ({ ...prev, [e.target.name]: parseFloat(e.target.value) || 0 }));

  // Auto-set cash% default when bank mode activates/deactivates
  useEffect(() => {
    if (fetchedA && fetchedB) {
      const isBankMode = companyTypeA === 'financial' && companyTypeB === 'financial';
      setInputs(prev => ({ ...prev, cashPercent: isBankMode ? 80 : 60 }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyTypeA, companyTypeB, fetchedA, fetchedB]);

  const handleSelectA = (symbol) => {
    setLoadingA(true); setErrorA(''); setBankFactsA(null);
    fetchCompanyData(symbol).then(data => {
      setNameA(data.name); setTickerA(symbol.toUpperCase());
      setCompanyTypeA(data.companyType || 'standard'); setDataSrcA(data.dataSource || '');
      setInputs(prev => ({ ...prev, companyARevenue: data.revenue, companyAEBITDA: data.ebitda,
        companyANetIncome: data.netIncome, companyAShares: data.shares, companyAEPS: data.eps,
        companyACash: data.cash, companyADebt: data.debt,
        currentSharePriceA: data.sharePrice || 0 }));
      setFetchedA(true); setLoadingA(false);
      if (data.companyType === 'financial') {
        getBankFacts(symbol).then(facts => { if (facts) setBankFactsA(facts); });
      }
    }).catch(() => { setErrorA('Could not load company. Try another.'); setLoadingA(false); });
  };

  const handleSelectB = (symbol) => {
    setLoadingB(true); setErrorB(''); setBankFactsB(null);
    setPriceStatusB({ loading: true, price: null, source: null, attempts: [] });
    fetchCompanyData(symbol).then(data => {
      setNameB(data.name); setTickerB(symbol.toUpperCase());
      setCompanyTypeB(data.companyType || 'standard'); setDataSrcB(data.dataSource || '');
      setInputs(prev => ({ ...prev, companyBRevenue: data.revenue, companyBEBITDA: data.ebitda,
        companyBNetIncome: data.netIncome, companyBShares: data.shares, companyBEPS: data.eps,
        companyBCash: data.cash, companyBDebt: data.debt,
        currentSharePriceB: data.sharePrice || 0 }));
      setFetchedB(true); setLoadingB(false);
      if (data.companyType === 'financial') {
        getBankFacts(symbol).then(facts => { if (facts) setBankFactsB(facts); });
      }
    }).catch(() => { setErrorB('Could not load company. Try another.'); setLoadingB(false); setPriceStatusB(p => ({ ...p, loading: false })); });

    // Live price fetch runs in parallel — updates currentSharePriceB when it resolves
    fetchLivePrice(symbol).then(({ price, source, attempts }) => {
      if (price != null) {
        setInputs(prev => ({ ...prev, currentSharePriceB: price }));
      }
      setPriceStatusB({ loading: false, price, source, attempts });
    }).catch(() => {
      setPriceStatusB({ loading: false, price: null, source: null, attempts: [] });
    });
  };

  const handleSubmit = () => {
    const r = calculate(inputs);
    setResults(r);
    setAnalysisRun(true);
  };

  const handleEditInputs = () => setAnalysisRun(false);

  const handleReset = () => {
    setInputs(defaultInputs); setResults(null); setMode(null); setAnalysisRun(false);
    setFetchedA(false); setFetchedB(false);
    setNameA(''); setNameB(''); setTickerA(''); setTickerB('');
    setErrorA(''); setErrorB('');
    setCompanyTypeA('standard'); setCompanyTypeB('standard');
    setDataSrcA(''); setDataSrcB('');
    setBankFactsA(null); setBankFactsB(null);
    setPriceStatusB({ loading: false, price: null, source: null, attempts: [] });
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
    revenue: inputs.companyBRevenue, ebitda: inputs.companyBEBITDA,
    netIncome: inputs.companyBNetIncome, eps: inputs.companyBEPS,
    shares: inputs.companyBShares, cash: inputs.companyBCash,
    debt: inputs.companyBDebt, companyType: companyTypeB,
    // Acquisition price is the effective market cap being paid for TBV calc
    marketCap: results ? parseFloat(results.totalPurchasePrice) : inputs.companyBEPS * 15 * inputs.companyBShares,
    // Bank-specific fields (null for non-financial companies)
    tangibleBookValue: bankFactsB?.tangibleBookValue ?? null,
    netInterestIncome: bankFactsB?.netInterestIncome ?? null,
    nonInterestIncome: bankFactsB?.nonInterestIncome ?? null,
    nonInterestExpense: bankFactsB?.nonInterestExpense ?? null,
    cet1Ratio:         bankFactsB?.cet1Ratio ?? null,
    riskWeightedAssets: bankFactsB?.riskWeightedAssets ?? null,
    totalAssets:        bankFactsB?.totalAssets ?? null,
    totalDeposits:      bankFactsB?.totalDeposits ?? null,
  });

  const buildAcquirerForDeck = () => ({
    name: nameA || 'Acquirer', ticker: tickerA,
    revenue: inputs.companyARevenue, ebitda: inputs.companyAEBITDA,
    netIncome: inputs.companyANetIncome, eps: inputs.companyAEPS,
    shares: inputs.companyAShares, cash: inputs.companyACash,
    debt: inputs.companyADebt, companyType: companyTypeA,
    marketCap: inputs.companyAEPS * 15 * inputs.companyAShares,
    tangibleBookValue: bankFactsA?.tangibleBookValue ?? null,
    netInterestIncome: bankFactsA?.netInterestIncome ?? null,
    nonInterestIncome: bankFactsA?.nonInterestIncome ?? null,
    nonInterestExpense: bankFactsA?.nonInterestExpense ?? null,
    cet1Ratio:         bankFactsA?.cet1Ratio ?? null,
    riskWeightedAssets: bankFactsA?.riskWeightedAssets ?? null,
    totalAssets:        bankFactsA?.totalAssets ?? null,
    totalDeposits:      bankFactsA?.totalDeposits ?? null,
  });

  const buildDealForDeck = () => ({
    offerPrice: inputs.offerPricePerShare, cashPercent: inputs.cashPercent,
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
    // Dashboard section reads these directly
    _results: results,
    _inputs:  { ...inputs },
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

  // ── Synergy pre-computations for auto mode summary row
  const synAuto1 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 1) : null;
  const synAuto2 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 2) : null;
  const synAuto3 = fetchedA && fetchedB ? calcSuggestedSynergy(partialTarget, partialAcquirer, 3) : null;
  const hasSynSuggestions = synAuto1 != null && synAuto2 != null && synAuto3 != null;
  const synLabel = hasSynSuggestions
    ? `${fmtMoney(synAuto1)} → ${fmtMoney(synAuto2)} → ${fmtMoney(synAuto3)}`
    : null;
  const synSubtitle = bankDeal
    ? '5% / 8% / 11% of combined non-interest expense'
    : '2% / 3.5% / 5% of combined revenue';

  // ── Layout helpers ────────────────────────────────────────────────────────────

  const scrollToApp = () => document.getElementById('app-section').scrollIntoView({ behavior: 'smooth' });
  const btnStyle = () => ({ flex: 1, padding: '32px 24px', borderRadius: 12, border: '2px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'center' });
  const cardStyle = { background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #E5E7EB' };
  const sectionTitle = { color: '#0F2244', fontSize: 16, marginTop: 0, marginBottom: 16 };
  const col2 = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 24 };

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
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px' }}>
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
            <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>Easy<span style={{ color: '#4A9FD4' }}>M&A</span></div>
            {savedAnalyses.length > 0 && (
              <button onClick={() => setShowSaved(true)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 14px',
                fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
                💾 Saved ({savedAnalyses.length})
              </button>
            )}
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
              <div style={col2}>
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company A — Acquirer</h2>
                  <TickerSelect onSelect={handleSelectA} error={errorA} fetched={fetchedA} companyName={nameA} loading={loadingA} dataSource={dataSrcA} />
                  {fetchedA && (
                    <div style={{ marginTop: 12 }}>
                      <LargeNumericField label="Revenue ($M)" name="companyARevenue" value={inputs.companyARevenue} onChange={handleChange} />
                      {companyTypeA === 'financial' ? (
                        <BankFactsDisplay bankFacts={bankFactsA} />
                      ) : (
                        <LargeNumericField label="EBITDA ($M)" name="companyAEBITDA" value={inputs.companyAEBITDA} onChange={handleChange} />
                      )}
                      <LargeNumericField label="Net Income ($M)" name="companyANetIncome" value={inputs.companyANetIncome} onChange={handleChange} />
                      <InputField label="Shares Outstanding (millions)" name="companyAShares" value={inputs.companyAShares} onChange={handleChange} />
                      <InputField label="EPS ($)" name="companyAEPS" value={inputs.companyAEPS} onChange={handleChange} />
                      <LargeNumericField label="Cash ($M)" name="companyACash" value={inputs.companyACash} onChange={handleChange} />
                      <LargeNumericField label="Total Debt ($M)" name="companyADebt" value={inputs.companyADebt} onChange={handleChange} />
                    </div>
                  )}
                </div>
                <div style={cardStyle}>
                  <h2 style={sectionTitle}>Company B — Target</h2>
                  <TickerSelect onSelect={handleSelectB} error={errorB} fetched={fetchedB} companyName={nameB} loading={loadingB} dataSource={dataSrcB} />
                  {fetchedB && (
                    <div style={{ marginTop: 12 }}>
                      <LargeNumericField label="Revenue ($M)" name="companyBRevenue" value={inputs.companyBRevenue} onChange={handleChange} />
                      {companyTypeB === 'financial' ? (
                        <BankFactsDisplay bankFacts={bankFactsB} />
                      ) : (
                        <LargeNumericField label="EBITDA ($M)" name="companyBEBITDA" value={inputs.companyBEBITDA} onChange={handleChange} />
                      )}
                      <LargeNumericField label="Net Income ($M)" name="companyBNetIncome" value={inputs.companyBNetIncome} onChange={handleChange} />
                      <InputField label="Shares Outstanding (millions)" name="companyBShares" value={inputs.companyBShares} onChange={handleChange} />
                      <InputField label="EPS ($)" name="companyBEPS" value={inputs.companyBEPS} onChange={handleChange} />
                      <LargeNumericField label="Cash ($M)" name="companyBCash" value={inputs.companyBCash} onChange={handleChange} />
                      <LargeNumericField label="Total Debt ($M)" name="companyBDebt" value={inputs.companyBDebt} onChange={handleChange} />
                    </div>
                  )}
                </div>
              </div>
              {fetchedA && fetchedB && (
                <div>
                  <div style={col2}>

                    {/* ── Deal Terms ─────────────────────────────────────── */}
                    <div style={cardStyle}>
                      <h2 style={sectionTitle}>Deal Terms</h2>

                      {/* Offer price suggestion + loading state */}
                      {priceStatusB.loading && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8, fontStyle: 'italic' }}>
                          ⟳ Fetching live share price…
                        </div>
                      )}
                      {suggestedPrice != null && suggestedPrice > 0 && (() => {
                        const sp = inputs.currentSharePriceB;
                        const prem = sp > 0 ? Math.round(((suggestedPrice - sp) / sp) * 100) : null;
                        const primaryText = prem != null
                          ? `${fmtPerShare(suggestedPrice)}/share (${prem}% premium)`
                          : `${fmtPerShare(suggestedPrice)}/share`;
                        const captionText = sp > 0
                          ? `30% control premium over current ${fmtPerShare(sp)} share price`
                          : null;
                        return (
                          <SuggestionBadge
                            primary={primaryText}
                            caption={captionText}
                            tooltip={buildOfferPriceTooltip(partialTarget)}
                            onUse={() => setInputs(prev => ({ ...prev, offerPricePerShare: suggestedPrice }))}
                          />
                        );
                      })()}
                      {!priceStatusB.loading && inputs.currentSharePriceB === 0 && priceStatusB.attempts.length > 0 && (
                        <PriceDiagnostic attempts={priceStatusB.attempts} />
                      )}

                      {/* Offer price input + conditional premium caption */}
                      <InputField label="Offer Price Per Share ($)" name="offerPricePerShare" value={inputs.offerPricePerShare} onChange={handleChange} placeholder="e.g., 974.06" />
                      {inputs.offerPricePerShare > 0 && (
                        <PremiumCaption offerPrice={inputs.offerPricePerShare} sharePrice={inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null} />
                      )}

                      {/* Cash/Stock Mix */}
                      <CashPercentageSlider
                        value={inputs.cashPercent}
                        onChange={(v) => setInputs(prev => ({ ...prev, cashPercent: v }))}
                        tooltip={buildCashPercentTooltip(bankDeal)}
                        dealSize={dealSizeForSlider}
                        acquirerSharePrice={acquirerSharePriceForSlider}
                        acquirerSharesOutstanding={inputs.companyAShares}
                      />

                      {/* Transaction Fees */}
                      {(() => {
                        const price = inputs.offerPricePerShare > 0 ? inputs.offerPricePerShare
                          : suggestedPrice > 0 ? suggestedPrice : 0;
                        const dealSizeM = price > 0 && inputs.companyBShares > 0 ? price * inputs.companyBShares : 0;
                        const totalFee = calcSuggestedTransactionFees(dealSizeM);
                        if (!totalFee) {
                          return (
                            <SuggestionBadge
                              label="Typical M&A fees: advisor (Lehman Formula) + legal"
                              tooltip={buildTransactionFeesTooltip(0, bankDeal)}
                            />
                          );
                        }
                        return (
                          <SuggestionBadge
                            primary={fmtMoneyDual(totalFee)}
                            tooltip={buildTransactionFeesTooltip(dealSizeM, bankDeal)}
                            onUse={() => setInputs(prev => ({ ...prev, transactionFees: totalFee }))}
                          />
                        );
                      })()}
                      <LargeNumericField label="Transaction Fees ($M)" name="transactionFees" value={inputs.transactionFees} onChange={handleChange} placeholder="e.g., 2,187" />
                    </div>

                    {/* ── Synergies ───────────────────────────────────────── */}
                    <div style={cardStyle}>
                      <h2 style={sectionTitle}>{bankDeal ? 'Synergies (Cost Takeouts)' : 'Synergies (Year 1 → Year 3)'}</h2>

                      {hasSynSuggestions ? (
                        <>
                          {/* Summary row */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6,
                            padding: '7px 10px', marginBottom: 6 }}>
                            <div style={{ fontSize: 12, color: '#0F2244', fontWeight: 600 }}>
                              💡 {synLabel}
                            </div>
                            <button
                              onClick={() => setInputs(prev => ({ ...prev, synergiesY1: synAuto1, synergiesY2: synAuto2, synergiesY3: synAuto3 }))}
                              style={{ background: '#0F2244', color: '#fff', border: 'none',
                                borderRadius: 4, padding: '3px 8px', fontSize: 11,
                                cursor: 'pointer', marginLeft: 8, flexShrink: 0 }}>
                              Use all
                            </button>
                          </div>

                          {/* Ramp subtitle with chevron */}
                          <CollapsibleNote label={`Suggested ramp: ${synSubtitle}`}>
                            {bankDeal
                              ? 'Cost savings ramp based on 5% / 8% / 11% of combined non-interest expense. Year 1 reflects initial back-office consolidation; Years 2–3 include branch rationalization and workforce optimization. These targets are consistent with large bank merger precedents.'
                              : 'Synergy ramp based on 2% / 3.5% / 5% of combined revenue. Year 1 captures quick-win cost overlaps; Years 2–3 include procurement, headcount reduction, and revenue cross-sell synergies. Industry precedents suggest 2–5% combined synergies over a 3-year integration window.'}
                          </CollapsibleNote>

                          {/* Per-year badges + inputs */}
                          {[1, 2, 3].map(yr => {
                            const suggested = yr === 1 ? synAuto1 : yr === 2 ? synAuto2 : synAuto3;
                            const name = `synergiesY${yr}`;
                            const fieldLabel = bankDeal ? `Year ${yr} Cost Savings ($M)` : `Year ${yr} Synergies ($M)`;
                            return (
                              <div key={yr}>
                                {suggested != null && (
                                  <SuggestionBadge
                                    primary={fmtMoneyDual(suggested)}
                                    tooltip={buildSynergyTooltip(partialTarget, partialAcquirer, yr)}
                                    onUse={() => setInputs(prev => ({ ...prev, [name]: suggested }))}
                                  />
                                )}
                                <InputField label={fieldLabel} name={name} value={inputs[name]} onChange={handleChange} placeholder={bankDeal ? 'Enter cost savings' : 'Enter synergies'} />
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        /* No suggestions — show inputs directly */
                        [1, 2, 3].map(yr => {
                          const fieldLabel = bankDeal ? `Year ${yr} Cost Savings ($M)` : `Year ${yr} Synergies ($M)`;
                          return (
                            <InputField key={yr} label={fieldLabel} name={`synergiesY${yr}`} value={inputs[`synergiesY${yr}`]} onChange={handleChange} placeholder={bankDeal ? 'Enter cost savings' : 'Enter synergies'} />
                          );
                        })
                      )}
                    </div>
                  </div>
                  <button onClick={handleSubmit} style={{ width: '100%', padding: 16, background: '#0F2244', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}>
                    Run Analysis →
                  </button>
                </div>
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
                  <InputField label="Offer Price Per Share ($)" name="offerPricePerShare" value={inputs.offerPricePerShare} onChange={handleChange} placeholder="e.g., 974.06" />
                  {inputs.offerPricePerShare > 0 && (
                    <PremiumCaption offerPrice={inputs.offerPricePerShare} sharePrice={inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null} />
                  )}
                  <CashPercentageSlider
                    value={inputs.cashPercent}
                    onChange={(v) => setInputs(prev => ({ ...prev, cashPercent: v }))}
                    tooltip={buildCashPercentTooltip(false)}
                    dealSize={inputs.offerPricePerShare > 0 && inputs.companyBShares > 0 ? inputs.offerPricePerShare * inputs.companyBShares : 0}
                    acquirerSharePrice={inputs.companyAEPS > 0 ? inputs.companyAEPS * 15 : 0}
                    acquirerSharesOutstanding={inputs.companyAShares}
                  />
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6,
                          padding: '7px 10px', marginBottom: 6 }}>
                          <div style={{ fontSize: 12, color: '#0F2244', fontWeight: 600 }}>
                            💡 {fmtMoney(s1)} → {fmtMoney(s2)} → {fmtMoney(s3)}
                          </div>
                          <button
                            onClick={() => setInputs(prev => ({ ...prev, synergiesY1: s1, synergiesY2: s2, synergiesY3: s3 }))}
                            style={{ background: '#0F2244', color: '#fff', border: 'none',
                              borderRadius: 4, padding: '3px 8px', fontSize: 11,
                              cursor: 'pointer', marginLeft: 8, flexShrink: 0 }}>
                            Use all
                          </button>
                        </div>
                        {/* Ramp subtitle with chevron */}
                        <CollapsibleNote label="Suggested ramp: 2% / 3.5% / 5% of combined revenue">
                          Synergy ramp based on 2% / 3.5% / 5% of combined revenue. Year 1 captures quick-win cost overlaps; Years 2–3 include procurement, headcount reduction, and revenue cross-sell synergies. Industry precedents suggest 2–5% combined synergies over a 3-year integration window.
                        </CollapsibleNote>
                        {[1, 2, 3].map(yr => {
                          const suggested = yr === 1 ? s1 : yr === 2 ? s2 : s3;
                          const name = `synergiesY${yr}`;
                          return (
                            <div key={yr}>
                              {suggested != null && (
                                <SuggestionBadge
                                  primary={fmtMoneyDual(suggested)}
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
