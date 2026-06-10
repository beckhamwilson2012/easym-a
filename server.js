const express = require('express');
const cors = require('cors');
const https = require('https');
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');
const { PEER_OVERRIDES } = require('./peerOverrides');
const yahooClient = require('./server/services/yahooClient'); // shared, cached Yahoo quote (dedup)
const cnbcClient  = require('./server/services/cnbcClient');  // keyless, reliable primary price source
console.log('[peerResolver] module loaded, override count:', Object.keys(PEER_OVERRIDES).length);

const app = express();
app.use(cors());

const FMP_KEY          = '6I3ipjC9tcfV6dpfR6CcXqsDcZCtMwyA';
const FINNHUB_KEY      = process.env.FINNHUB_KEY      || '';
const ALPHAVANTAGE_KEY = process.env.ALPHAVANTAGE_KEY || '';

const priceCache   = new Map();
const CACHE_TTL_MS = 300_000; // 5 min — longer TTL reduces Yahoo call frequency (avoids 429s)

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'EasyMandA contact@easymanda.com',
          'Accept-Encoding': 'gzip',
          ...extraHeaders,
        },
      },
      (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`));
        }
        const stream =
          res.headers['content-encoding'] === 'gzip'
            ? res.pipe(zlib.createGunzip())
            : res;
        let data = '';
        stream.on('data', (chunk) => (data += chunk));
        stream.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('JSON parse error')); }
        });
        stream.on('error', reject);
      }
    ).on('error', reject);
  });
}

// Loaded once on first request, then reused
let tickerCache = null;
let cikBySymbol = {};

// EDGAR facts cache — avoids double-fetching the same large JSON within a session.
// The bank-facts endpoint reuses facts already pulled during /quote (same CIK).
const edgarFactsCache   = new Map();
const EDGAR_CACHE_TTL_MS = 300_000; // 5 minutes

function getEdgarFactsCache(cik) {
  const c = edgarFactsCache.get(cik);
  return c && Date.now() - c.ts < EDGAR_CACHE_TTL_MS ? c.facts : null;
}

function setEdgarFactsCache(cik, facts) {
  edgarFactsCache.set(cik, { ts: Date.now(), facts });
}

// SIC cache — lazy, populated as tickers are analyzed; persisted to disk across restarts
const sicCache = new Map();
const SIC_CACHE_FILE = path.join(__dirname, 'sic-cache.json');
try {
  const raw = fs.readFileSync(SIC_CACHE_FILE, 'utf8');
  for (const [cik, entry] of Object.entries(JSON.parse(raw))) {
    sicCache.set(cik, entry);
  }
  console.log(`[SIC cache] Loaded ${sicCache.size} entries from disk`);
} catch (_) { /* file doesn't exist yet */ }

let sicWriteTimer = null;
function debouncedSicWrite() {
  if (sicWriteTimer) clearTimeout(sicWriteTimer);
  sicWriteTimer = setTimeout(() => {
    const obj = {};
    for (const [k, v] of sicCache.entries()) obj[k] = v;
    fs.writeFile(SIC_CACHE_FILE, JSON.stringify(obj, null, 2), () => {});
  }, 500);
}

async function loadTickers() {
  if (tickerCache) return;
  const data = await get('https://www.sec.gov/files/company_tickers.json');
  tickerCache = Object.values(data).map((e) => ({
    symbol: e.ticker.toUpperCase(),
    name: e.title,
    cik: String(e.cik_str).padStart(10, '0'),
  }));
  for (const entry of tickerCache) {
    cikBySymbol[entry.symbol] = entry.cik;
  }
}

async function fetchSubmissions(cik) {
  if (sicCache.has(cik)) return sicCache.get(cik);
  const data = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const entry = { sic: data.sic ? String(data.sic) : null, sicDescription: data.sicDescription || null };
  sicCache.set(cik, entry);
  debouncedSicWrite();
  return entry;
}

app.get('/search', async (req, res) => {
  const raw = (req.query.q || '').trim();
  try {
    await loadTickers();
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();
    const results = tickerCache
      .filter(
        (e) => e.symbol.startsWith(upper) || e.name.toLowerCase().includes(lower)
      )
      .sort((a, b) => {
        const aExact = a.symbol === upper, bExact = b.symbol === upper;
        if (aExact !== bExact) return aExact ? -1 : 1;
        const aPrefix = a.symbol.startsWith(upper), bPrefix = b.symbol.startsWith(upper);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
        return 0;
      })
      .slice(0, 8)
      .map(({ symbol, name }) => ({ symbol, name }));
    res.json(results);
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

// ── EDGAR helpers ─────────────────────────────────────────────────────────────

// Accepts both 10-K (domestic) and 20-F (foreign private issuer) annual filings.
// When multiple entries share the same end date takes the max — consolidated
// total is always >= any individual segment breakdown.
function latestAnnualEntry(concept, unit) {
  const entries = concept?.units?.[unit];
  if (!entries?.length) return null;
  const annuals = entries.filter((e) => e.form === '10-K' || e.form === '20-F');
  if (!annuals.length) return null;
  const latestEnd = annuals.reduce((max, e) => (e.end > max ? e.end : max), '');
  const forLatest = annuals.filter((e) => e.end === latestEnd);
  return { end: latestEnd, val: Math.max(...forLatest.map((e) => e.val)) };
}

function latestAnnual(concept, unit) {
  return latestAnnualEntry(concept, unit)?.val ?? null;
}

// Returns value from the concept with the most recent end date across candidates.
function pick(namespace, names, unit = 'USD') {
  let best = null;
  for (const name of names) {
    const entry = latestAnnualEntry(namespace[name], unit);
    if (!entry) continue;
    if (!best || entry.end > best.end) best = entry;
  }
  return best?.val ?? 0;
}

function pickWithSource(namespace, names, unit = 'USD') {
  let best = null;
  let bestName = null;
  for (const name of names) {
    const entry = latestAnnualEntry(namespace[name], unit);
    if (!entry) continue;
    if (!best || entry.end > best.end) { best = entry; bestName = name; }
  }
  return { val: best?.val ?? 0, concept: bestName, entry: best };
}

function inM(val) {
  return Math.round((val || 0) / 1e6);
}

// Last `n` distinct annual values for a concept, oldest→newest (for multi-year trajectory charts).
// Dedupes by fiscal-year-end (keeps the largest val per end — handles restatements/amendments).
function annualSeries(concept, unit, n = 4) {
  const entries = concept?.units?.[unit];
  if (!entries?.length) return [];
  const annuals = entries.filter((e) => e.form === '10-K' || e.form === '20-F');
  const byEnd = {};
  for (const e of annuals) { if (!byEnd[e.end] || e.val > byEnd[e.end].val) byEnd[e.end] = e; }
  return Object.values(byEnd)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-n)
    // EDGAR's `fy` tag is unreliable (off-by-one for Jan-FYE filers, duplicated across amendments), so
    // derive the fiscal-year label from the period-END calendar year — the convention used elsewhere
    // in the deck (CRM FYE Jan-2026 → FY2026; TEAM FYE Jun-2025 → FY2025).
    .map((e) => ({ end: e.end, fy: parseInt(e.end.slice(0, 4), 10), revenue: inM(e.val) }));
}

// ── Data sources ──────────────────────────────────────────────────────────────

async function fetchFromEDGAR(symbol, cik) {
  const [factsResult, sicResult] = await Promise.allSettled([
    (async () => {
      let facts = getEdgarFactsCache(cik);
      if (!facts) {
        facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
        setEdgarFactsCache(cik, facts);
      }
      return facts;
    })(),
    fetchSubmissions(cik),
  ]);
  if (factsResult.status === 'rejected') throw factsResult.reason;
  const facts = factsResult.value;
  const sicData = sicResult.status === 'fulfilled' ? sicResult.value : { sic: null, sicDescription: null };

  const gaap = facts.facts?.['us-gaap']   || {};
  const ifrs = facts.facts?.['ifrs-full'] || {};
  const dei  = facts.facts?.['dei']       || {};

  const gaapCount = Object.keys(gaap).length;
  const ifrsCount = Object.keys(ifrs).length;
  console.log(`[${symbol}] EDGAR namespaces — us-gaap: ${gaapCount} concepts, ifrs-full: ${ifrsCount} concepts, dei: ${Object.keys(dei).length} concepts`);

  // Foreign private issuers (e.g. Shell, Alibaba) file under ifrs-full, not us-gaap
  const useIfrs = ifrsCount > 0 && gaapCount === 0;
  console.log(`[${symbol}] EDGAR using ${useIfrs ? 'IFRS (20-F filer)' : 'US-GAAP (10-K filer)'}`);

  let revenue, revenueConcept;
  let revenueEntry = null;
  if (useIfrs) {
    ({ val: revenue, concept: revenueConcept, entry: revenueEntry } = pickWithSource(ifrs, [
      'Revenue',
      'RevenueFromContractsWithCustomers',
      'OtherRevenue',
      'RevenueAndOtherIncome',
    ]));
  } else {
    ({ val: revenue, concept: revenueConcept, entry: revenueEntry } = pickWithSource(gaap, [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'RevenuesNetOfInterestExpense',
      'InterestAndFeeIncomeLoansAndLeases',
    ]));
  }

  const netIncome = useIfrs
    ? pick(ifrs, ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'])
    : pick(gaap, ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']);

  // IFRS filers often don't tag operating income separately; ProfitLossBeforeTax
  // is the closest proxy (before finance items + tax → approximates EBIT).
  const operatingIncome = useIfrs
    ? pick(ifrs, ['OperatingProfitLoss', 'ProfitLossFromOperatingActivities', 'ProfitLossBeforeTax'])
    : pick(gaap, ['OperatingIncomeLoss']);

  const da = useIfrs
    ? pick(ifrs, [
        'DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
        'AdjustmentsForDepreciationAndAmortisationExpenseAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
        'DepreciationAndAmortisationExpense',
        'DepreciationAmortisationAndImpairmentLoss',
        'DepreciationAndAmortisation',
      ])
    : pick(gaap, ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization']);

  const ebitda = operatingIncome === 0 ? 0 : operatingIncome + da;

  // Free cash flow = OCF + CapEx (CapEx stored as a negative outflow). Always from us-gaap — IFRS 20-F
  // filers that don't tag us-gaap cash-flow concepts resolve to null (not fabricated), matching the
  // verified-data edgarClient exactly so the comps screening table stays consistent with §10.
  const ocf   = pick(gaap, ['NetCashProvidedByUsedInOperatingActivities']);
  const capex = pick(gaap, ['PaymentsToAcquirePropertyPlantAndEquipment']);
  const freeCashFlow = (ocf !== 0 && capex !== 0) ? inM(ocf + capex) : null;

  const companyType = ['RevenuesNetOfInterestExpense', 'InterestAndFeeIncomeLoansAndLeases']
    .includes(revenueConcept) ? 'financial' : 'standard';

  // DEI namespace covers both domestic and foreign annual filers.
  // Atlassian (and other IFRS 20-F filers) have no CommonStockSharesOutstanding 10-K entries
  // but DO have WeightedAverageNumberOfSharesOutstandingBasic in a 10-K filing.
  const shares =
    latestAnnual(gaap['CommonStockSharesOutstanding'], 'shares') ??
    latestAnnual(dei['EntityCommonStockSharesOutstanding'], 'shares') ??
    latestAnnual(gaap['WeightedAverageNumberOfSharesOutstandingBasic'], 'shares') ??
    latestAnnual(gaap['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares') ??
    0;

  const eps = useIfrs
    ? (latestAnnual(ifrs['BasicEarningsLossPerShareFromContinuingOperations'],   'USD/shares') ??
       latestAnnual(ifrs['DilutedEarningsLossPerShareFromContinuingOperations'],  'USD/shares') ??
       latestAnnual(ifrs['BasicEarningsLossPerShare'],                            'USD/shares') ??
       latestAnnual(ifrs['DilutedEarningsLossPerShare'],                          'USD/shares') ?? 0)
    : (latestAnnual(gaap['EarningsPerShareBasic'],  'USD/shares') ??
       latestAnnual(gaap['EarningsPerShareDiluted'], 'USD/shares') ?? 0);

  const cash = useIfrs
    ? pick(ifrs, ['CashAndCashEquivalents'])
    : pick(gaap, ['CashAndCashEquivalentsAtCarryingValue']);

  const debt = useIfrs
    ? pick(ifrs, ['LongtermBorrowings', 'Borrowings', 'NoncurrentPortionOfLongtermBorrowings'])
    : pick(gaap, ['LongTermDebt', 'LongTermDebtNoncurrent']);

  const revenueM = inM(revenue);
  const sharesM  = inM(shares);
  console.log(`[${symbol}] EDGAR extracted — revenue: ${revenueM}M (concept: ${revenueConcept}), shares: ${sharesM}M, eps: ${eps}, ebitda: ${inM(ebitda)}M, netIncome: ${inM(netIncome)}M`);

  if (revenueM === 0 && sharesM === 0) return null;

  return {
    name:           facts.entityName || symbol,
    companyType,
    revenue:        revenueM,
    ebitda:         inM(ebitda),
    operatingIncome: inM(operatingIncome), // screening table (matches verified edgarClient)
    freeCashFlow,                          // null for IFRS filers with no us-gaap cash-flow tags
    // Last 4 annual revenues (oldest→newest) for the §6 multi-year revenue-trajectory line chart.
    revenueHistory: annualSeries((useIfrs ? ifrs : gaap)[revenueConcept], 'USD', 4),
    netIncome:      inM(netIncome),
    shares:         sharesM,
    eps:            parseFloat(eps.toFixed(2)),
    cash:           inM(cash),
    debt:           inM(debt),
    sic:            sicData.sic,
    sicDescription: sicData.sicDescription,
    dataSource:     'sec_edgar',
    // Fiscal period of the revenue figure — used for correct deck labels.
    // EDGAR's `fy` field is frequently empty in companyfacts, so derive the fiscal year from the
    // period-END calendar year (the standard convention: CRM FYE 2026-01-31 → FY2026,
    // TEAM FYE 2025-06-30 → FY2025). This prevents mislabeling TEAM's FY25 figures as FY26.
    fiscalYearEnd:  revenueEntry?.end   ?? null,  // e.g. "2025-06-30"
    fiscalYear:     revenueEntry?.fy ?? (revenueEntry?.end ? parseInt(revenueEntry.end.slice(0, 4), 10) : null),
    fiscalPeriod:   revenueEntry?.fp    ?? null,  // "FY", "Q1"–"Q4"
    filingForm:     revenueEntry?.form  ?? null,  // "10-K" or "20-F"
  };
}

async function fetchFromFMP(symbol) {
  console.log(`[${symbol}] FMP — fetching income, profile, balance in parallel`);
  const [incomeData, profileData, balanceData] = await Promise.all([
    get(`https://financialmodelingprep.com/api/v4/income-statement/${symbol}?period=annual&limit=1&apikey=${FMP_KEY}`),
    get(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP_KEY}`),
    get(`https://financialmodelingprep.com/api/v3/balance-sheet-statement/${symbol}?period=annual&limit=1&apikey=${FMP_KEY}`),
  ]);

  const income  = Array.isArray(incomeData)  ? incomeData[0]  : null;
  const profile = Array.isArray(profileData) ? profileData[0] : null;
  const balance = Array.isArray(balanceData) ? balanceData[0] : null;

  console.log(`[${symbol}] FMP raw — income: ${income ? 'ok' : 'missing/error'}, profile: ${profile ? 'ok' : 'missing/error'}, balance: ${balance ? 'ok' : 'missing/error'}`);
  if (income)  console.log(`[${symbol}] FMP income — revenue: ${income.revenue}, netIncome: ${income.netIncome}, ebitda: ${income.ebitda}`);
  if (profile) console.log(`[${symbol}] FMP profile — name: ${profile.companyName}, shares: ${profile.sharesOutstanding}`);

  const revenue   = income?.revenue   || 0;
  const netIncome = income?.netIncome || 0;
  const ebitda    = income?.ebitda    || ((income?.operatingIncome || 0) + (income?.depreciationAndAmortization || 0));
  const eps       = income?.eps       || 0;
  const shares    = profile?.sharesOutstanding || 0;
  const cash      = balance?.cashAndCashEquivalents || 0;
  const debt      = balance?.totalDebt || balance?.longTermDebt || 0;
  const name      = profile?.companyName || symbol;

  const revenueM = inM(revenue);
  const sharesM  = inM(shares);
  console.log(`[${symbol}] FMP extracted — revenue: ${revenueM}M, shares: ${sharesM}M`);
  if (revenueM === 0 && sharesM === 0) return null;

  return {
    name,
    companyType: 'standard',
    revenue:    revenueM,
    ebitda:     inM(ebitda),
    netIncome:  inM(netIncome),
    shares:     sharesM,
    eps:        parseFloat((eps || 0).toFixed(2)),
    cash:       inM(cash),
    debt:       inM(debt),
    sharePrice: profile?.price ? parseFloat(profile.price.toFixed(2)) : null,
    dataSource: 'fmp',
  };
}

async function fetchFromYahoo(symbol) {
  console.log(`[${symbol}] Yahoo — fetching quoteSummary`);
  const data = await get(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,incomeStatementHistory,quoteType`,
    { Accept: 'application/json' }
  );

  const result = data?.quoteSummary?.result?.[0];
  console.log(`[${symbol}] Yahoo raw — result present: ${!!result}, error: ${JSON.stringify(data?.quoteSummary?.error)}`);
  if (!result) return null;

  const fd  = result.financialData || {};
  const ks  = result.defaultKeyStatistics || {};
  const ish = result.incomeStatementHistory?.incomeStatementHistory?.[0] || {};
  const qt  = result.quoteType || {};

  const revenue   = fd.totalRevenue?.raw  || ish.totalRevenue?.raw || 0;
  const ebitda    = fd.ebitda?.raw        || 0;
  const netIncome = ish.netIncome?.raw    || 0;
  const shares    = ks.sharesOutstanding?.raw || 0;
  const eps       = ks.trailingEps?.raw   || 0;
  const cash      = fd.totalCash?.raw     || 0;
  const debt      = fd.totalDebt?.raw     || 0;
  const name      = qt.longName || qt.shortName || symbol;

  console.log(`[${symbol}] Yahoo extracted — revenue: ${inM(revenue)}M, shares: ${inM(shares)}M, eps: ${eps}`);

  const revenueM = inM(revenue);
  const sharesM  = inM(shares);
  if (revenueM === 0 && sharesM === 0) return null;

  return {
    name,
    companyType: 'standard',
    revenue:    revenueM,
    ebitda:     inM(ebitda),
    netIncome:  inM(netIncome),
    shares:     sharesM,
    eps:        parseFloat((eps || 0).toFixed(2)),
    cash:       inM(cash),
    debt:       inM(debt),
    sharePrice: fd.currentPrice?.raw ? parseFloat(fd.currentPrice.raw.toFixed(2)) : null,
    dataSource: 'yahoo',
  };
}

// ── Live price helpers (used by /api/price/:ticker waterfall) ─────────────────

// CNBC's keyless quote service — reliable primary source that does not rate-limit like Yahoo.
async function tryCnbcPrice(ticker) {
  return cnbcClient.fetchPrice(ticker);
}

// Yahoo v8/chart, via the SHARED cached client so the deal model and the Source Verification panel
// reuse one Yahoo call per ticker (the duplicate calls are what triggered Yahoo's HTTP 429).
async function tryYahooPrice(ticker) {
  return yahooClient.fetchPrice(ticker);
}

async function tryFmpPrice(ticker) {
  const data = await get(`https://financialmodelingprep.com/api/v3/quote-short/${ticker}?apikey=${FMP_KEY}`);
  const quote = Array.isArray(data) ? data[0] : null;
  if (!quote?.price) return null;
  return parseFloat(quote.price.toFixed(2));
}

async function tryFinnhub(ticker) {
  if (!FINNHUB_KEY) return null;
  const data = await get(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
  if (!data?.c || data.c === 0) return null;
  return parseFloat(data.c.toFixed(2));
}

async function tryAlphaVantage(ticker) {
  if (!ALPHAVANTAGE_KEY) return null;
  const data = await get(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHAVANTAGE_KEY}`);
  if (data?.Note || data?.Information) return null; // throttled / exceeded plan
  const raw = parseFloat(data?.['Global Quote']?.['05. price']);
  if (!raw || isNaN(raw)) return null;
  return parseFloat(raw.toFixed(2));
}

// ── Quote endpoint ────────────────────────────────────────────────────────────

app.get('/quote', async (req, res) => {
  const symbol = (req.query.symbol || '').toUpperCase();
  try {
    await loadTickers();

    let result = null;
    const cik = cikBySymbol[symbol];
    console.log(`\n[${symbol}] ── quote request ──`);
    console.log(`[${symbol}] CIK: ${cik || 'NOT FOUND in SEC ticker list'}`);

    // Source 1: SEC EDGAR
    if (cik) {
      console.log(`[${symbol}] Trying SEC EDGAR…`);
      try {
        result = await fetchFromEDGAR(symbol, cik);
        console.log(`[${symbol}] EDGAR result: ${result ? `✓ revenue ${result.revenue}M shares ${result.shares}M` : '✗ null (all zeros)'}`);
      } catch (e) {
        console.error(`[${symbol}] EDGAR error:`, e.message);
      }
    }

    // Source 2: Financial Modeling Prep
    if (!result) {
      console.log(`[${symbol}] Trying FMP…`);
      try {
        result = await fetchFromFMP(symbol);
        console.log(`[${symbol}] FMP result: ${result ? `✓ revenue ${result.revenue}M shares ${result.shares}M` : '✗ null'}`);
      } catch (e) {
        console.error(`[${symbol}] FMP error:`, e.message);
      }
    }

    // Source 3: Yahoo Finance
    if (!result) {
      console.log(`[${symbol}] Trying Yahoo Finance…`);
      try {
        result = await fetchFromYahoo(symbol);
        console.log(`[${symbol}] Yahoo result: ${result ? `✓ revenue ${result.revenue}M shares ${result.shares}M` : '✗ null'}`);
      } catch (e) {
        console.error(`[${symbol}] Yahoo error:`, e.message);
      }
    }

    if (!result) {
      console.log(`[${symbol}] All sources failed — returning zeros`);
      return res.json({
        name: symbol, dataSource: 'none', companyType: 'standard',
        revenue: 0, ebitda: 0, netIncome: 0, shares: 0, eps: 0, cash: 0, debt: 0,
      });
    }

    console.log(`[${symbol}] ✓ Final result from ${result.dataSource}`);
    res.json(result);
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: 'Failed to fetch company data' });
  }
});

// ── Bank facts endpoint ───────────────────────────────────────────────────────

app.get('/api/bank-facts/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    await loadTickers();
    const cik = cikBySymbol[ticker];
    if (!cik) return res.json(null);

    let facts = getEdgarFactsCache(cik);
    if (!facts) {
      facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
      setEdgarFactsCache(cik, facts);
    }
    const gaap = facts.facts?.['us-gaap'] || {};

    // Tangible book value = equity − goodwill − intangibles
    const equity     = pick(gaap, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
    const goodwill   = pick(gaap, ['Goodwill']);
    const intangibles= pick(gaap, ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet', 'OtherIntangibleAssetsNet']);
    const tbv = equity - goodwill - intangibles;

    // Net interest income
    let nii = pick(gaap, ['InterestIncomeExpenseNet', 'NetInterestIncome']);
    if (!nii) {
      const intInc = pick(gaap, ['InterestIncomeOperating', 'InterestAndFeeIncomeLoansAndLeases', 'InterestIncome']);
      const intExp = pick(gaap, ['InterestExpense']);
      if (intInc && intExp) nii = intInc - intExp;
    }

    const nonIntInc = pick(gaap, ['NoninterestIncome', 'OtherNoninterestIncome']);
    const nonIntExp = pick(gaap, ['NoninterestExpense', 'OtherNoninterestExpense']);

    // CET1 / Tier 1 ratio — stored as decimal (0.15 = 15%)
    let cet1 = null;
    const cet1Entry = latestAnnualEntry(gaap['TierOneRiskBasedCapitalToRiskWeightedAssets'], 'pure')
                   || latestAnnualEntry(gaap['TierOneRiskBasedCapitalToRiskWeightedAssets'], 'USD');
    if (cet1Entry) {
      cet1 = cet1Entry.val;
      if (cet1 > 1.0) cet1 = cet1 / 100; // normalize if filed as percentage
    }

    const rwa         = pick(gaap, ['RiskWeightedAssets']);
    const totalAssets = pick(gaap, ['Assets']);
    const deposits    = pick(gaap, ['Deposits', 'DepositLiabilitiesReclassifiedAsLoansReceivable']);

    return res.json({
      tangibleBookValue:  tbv > 0 ? inM(tbv) : null,
      netInterestIncome:  nii > 0 ? inM(nii) : null,
      nonInterestIncome:  nonIntInc > 0 ? inM(nonIntInc) : null,
      nonInterestExpense: nonIntExp > 0 ? inM(nonIntExp) : null,
      cet1Ratio:          cet1,
      riskWeightedAssets: rwa > 0 ? inM(rwa) : null,
      totalAssets:        totalAssets > 0 ? inM(totalAssets) : null,
      totalDeposits:      deposits > 0 ? inM(deposits) : null,
    });
  } catch (err) {
    console.error(`BankFacts [${ticker}]:`, err.message);
    res.json(null);
  }
});

// ── Live price endpoint ───────────────────────────────────────────────────────

app.get('/api/price/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();

  const cached = priceCache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.json(cached.payload);
  }

  const sources = [
    { name: 'finnhub',      fn: () => tryFinnhub(ticker) },      // free WITH key; real-time, no rate-limit
    { name: 'cnbc',         fn: () => tryCnbcPrice(ticker) },    // free, no key; reliable, no rate-limit
    { name: 'yahoo',        fn: () => tryYahooPrice(ticker) },   // free, no key; rate-limits (429) — backup
    { name: 'alphavantage', fn: () => tryAlphaVantage(ticker) }, // free with key
    { name: 'fmp',          fn: () => tryFmpPrice(ticker) },     // paid; 403 on free key
  ];

  const attempts = [];
  let price = null;
  let source = null;

  for (const { name, fn } of sources) {
    try {
      const result = await fn();
      attempts.push({ source: name, ok: result !== null });
      if (result !== null) {
        price = result;
        source = name;
        console.log(`[price] ${ticker} = $${price} via ${source}`);
        break;
      }
    } catch (e) {
      attempts.push({ source: name, ok: false, error: e.message });
      console.log(`[price] ${ticker} ${name} failed: ${e.message}`);
    }
  }

  const payload = price !== null
    ? { price, source, attempts }
    : { error: 'Price unavailable from all sources', attempts };

  // Only cache SUCCESSFUL prices. Caching a failure would pin a transient 429 for the whole TTL.
  if (price !== null) priceCache.set(ticker, { ts: Date.now(), payload });
  res.json(payload);
});

// ── Segment revenue endpoint ──────────────────────────────────────────────────

function cleanConceptName(name) {
  return name
    .replace(/RevenueFromContractWithCustomer(ExcludingAssessedTax|IncludingAssessedTax)?/g, '')
    .replace(/AndSupport|Professional(Services)?/g, s => ' ' + s)
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim();
}

app.get('/api/segments/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    await loadTickers();
    const cik = cikBySymbol[ticker];
    if (!cik) return res.json({ source: 'estimated', year: null, segments: [] });

    const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const gaap = facts.facts?.['us-gaap'] || {};

    const revNames = [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues', 'SalesRevenueNet',
    ];
    let totalEntry = null;
    for (const name of revNames) {
      const e = latestAnnualEntry(gaap[name], 'USD');
      if (e) { totalEntry = e; break; }
    }
    if (!totalEntry) return res.json({ source: 'estimated', year: null, segments: [] });

    const totalVal = totalEntry.val;
    const latestEnd = totalEntry.end;
    const year = latestEnd.slice(0, 4);

    const candidates = [];
    for (const [cname, cdata] of Object.entries(gaap)) {
      const lower = cname.toLowerCase();
      if (!lower.includes('revenue') && !lower.includes('subscription') && !lower.includes('service')) continue;
      if (cname === 'Revenues' || cname === 'SalesRevenueNet') continue;
      if (revNames.includes(cname)) continue;
      const units = cdata?.units?.USD;
      if (!units) continue;
      const matching = units.filter(e =>
        e.end === latestEnd &&
        (e.form === '10-K' || e.form === '20-F') &&
        e.val > 0 &&
        e.val < totalVal * 0.99 &&
        Math.abs(e.val - totalVal) > totalVal * 0.005
      );
      if (!matching.length) continue;
      const best = matching.sort((a, b) => (b.filed > a.filed ? 1 : -1))[0];
      candidates.push({ name: cname, val: best.val });
    }

    // Deduplicate by rounded value
    const seen = new Set();
    const unique = candidates.filter(c => {
      const key = Math.round(c.val / 1e5);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sum = unique.reduce((a, c) => a + c.val, 0);
    if (unique.length >= 2 && sum >= totalVal * 0.65 && sum <= totalVal * 1.2) {
      const segments = unique
        .sort((a, b) => b.val - a.val)
        .slice(0, 6)
        .map(c => ({ name: cleanConceptName(c.name), value: Math.round(c.val / 1e6) }));
      return res.json({ source: 'reported', year, segments });
    }

    return res.json({ source: 'estimated', year, segments: [] });
  } catch (err) {
    console.error(`Segments [${ticker}]:`, err.message);
    res.json({ source: 'estimated', year: null, segments: [] });
  }
});

// ── Quarterly revenue endpoint ────────────────────────────────────────────────

function monthLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const mo = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const yr = String(d.getUTCFullYear()).slice(2);
  return `${mo} '${yr}`;
}

app.get('/api/quarterly/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    await loadTickers();
    const cik = cikBySymbol[ticker];
    if (!cik) return res.json({ available: false, quarters: [] });

    const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const gaap = facts.facts?.['us-gaap'] || {};

    const revNames = [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues', 'SalesRevenueNet',
    ];
    let allEntries = null;
    for (const name of revNames) {
      const entries = gaap[name]?.units?.USD;
      if (entries?.length) { allEntries = entries; break; }
    }
    if (!allEntries) return res.json({ available: false, quarters: [] });

    // Separate quarterly (10-Q) and annual (10-K) entries
    const qEntries = allEntries.filter(e => e.form === '10-Q' && ['Q1', 'Q2', 'Q3'].includes(e.fp));
    const fyEntries = allEntries.filter(e => (e.form === '10-K' || e.form === '20-F') && e.fp === 'FY');

    if (qEntries.length < 6) return res.json({ available: false, quarters: [] });

    // For each FY entry, find corresponding Q1/Q2/Q3 and compute Q4
    const all = [];
    const usedFY = fyEntries.sort((a, b) => b.end.localeCompare(a.end)).slice(0, 5);

    for (const fy of usedFY) {
      const fyEnd = fy.end;
      const fyStartMs = new Date(fyEnd).getTime() - 366 * 24 * 60 * 60 * 1000;

      const inRange = qEntries.filter(q => {
        const t = new Date(q.end).getTime();
        return t > fyStartMs && t < new Date(fyEnd).getTime();
      });

      const qMap = {};
      for (const q of inRange) {
        if (!qMap[q.fp] || q.filed > qMap[q.fp].filed) qMap[q.fp] = q;
      }

      if (qMap.Q1) all.push({ end: qMap.Q1.end, val: qMap.Q1.val });
      if (qMap.Q2) all.push({ end: qMap.Q2.end, val: qMap.Q2.val });
      if (qMap.Q3) all.push({ end: qMap.Q3.end, val: qMap.Q3.val });
      if (qMap.Q1 && qMap.Q2 && qMap.Q3) {
        const q4 = fy.val - qMap.Q1.val - qMap.Q2.val - qMap.Q3.val;
        if (q4 > 0) all.push({ end: fyEnd, val: q4 });
      }
    }

    // Sort by end date, deduplicate
    all.sort((a, b) => a.end.localeCompare(b.end));
    const deduped = all.filter((q, i) => i === 0 || q.end !== all[i - 1].end);

    if (deduped.length < 4) return res.json({ available: false, quarters: [] });

    // Take last 12 to compute YoY for last 8
    const last12 = deduped.slice(-12);
    const output = last12.map((q, i) => {
      const priorIdx = i - 4;
      const prior = priorIdx >= 0 ? last12[priorIdx] : null;
      const yoy = prior && prior.val > 0 ? parseFloat(((q.val - prior.val) / prior.val * 100).toFixed(1)) : null;
      return { label: monthLabel(q.end), total: Math.round(q.val / 1e6), yoyGrowth: yoy };
    }).slice(-8);

    res.json({ available: true, quarters: output });
  } catch (err) {
    console.error(`Quarterly [${ticker}]:`, err.message);
    res.json({ available: false, quarters: [] });
  }
});

// ── Price history endpoint ────────────────────────────────────────────────────

app.get('/api/prices/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    // Try FMP first
    const fmpUrl = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?serietype=line&apikey=${FMP_KEY}`;
    let daily = null;
    let provider = null; // track which feed actually returned data — never claim FMP when it 403s

    try {
      const fmpData = await get(fmpUrl);
      if (fmpData?.historical?.length) {
        daily = fmpData.historical.map(d => ({ date: d.date, close: d.close }));
        provider = 'fmp';
      }
    } catch (e) {
      console.log(`[${ticker}] FMP price failed:`, e.message);
    }

    // Fallback: Yahoo Finance
    if (!daily) {
      try {
        const yahooData = await get(
          `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1mo`,
          { Accept: 'application/json' }
        );
        const result = yahooData?.chart?.result?.[0];
        if (result?.timestamp && result?.indicators?.adjclose?.[0]?.adjclose) {
          const timestamps = result.timestamp;
          const closes = result.indicators.adjclose[0].adjclose;
          daily = timestamps.map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().slice(0, 10),
            close: closes[i],
          })).filter(d => d.close != null);
          if (daily.length) provider = 'yahoo';
        }
      } catch (e) {
        console.log(`[${ticker}] Yahoo price failed:`, e.message);
      }
    }

    if (!daily || daily.length < 2) {
      return res.json({ source: 'illustrative', series: [] });
    }

    // Reduce to month-end: keep last entry per calendar month
    daily.sort((a, b) => a.date.localeCompare(b.date));

    // Filter to last 13 months
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 13);
    const recent = daily.filter(d => new Date(d.date) >= cutoff);
    if (recent.length < 2) return res.json({ source: 'illustrative', series: [] });

    const monthMap = {};
    for (const d of recent) {
      const mo = d.date.slice(0, 7); // "YYYY-MM"
      monthMap[mo] = d.close; // last entry per month wins
    }

    const months = Object.keys(monthMap).sort();
    if (months.length < 2) return res.json({ source: 'illustrative', series: [] });

    const base = monthMap[months[0]];
    const series = months.map(mo => ({
      month: mo,
      value: parseFloat(((monthMap[mo] / base) * 100).toFixed(2)),
    }));

    res.json({ source: provider || 'illustrative', series });
  } catch (err) {
    console.error(`Prices [${ticker}]:`, err.message);
    res.json({ source: 'illustrative', series: [] });
  }
});

// ── Peer resolution ───────────────────────────────────────────────────────────

async function resolvePeers(targetTicker) {
  const upper = targetTicker.toUpperCase();

  // 1. Hand-curated override map
  if (PEER_OVERRIDES[upper]) {
    console.log(`[resolvePeers] ${upper} → override hit, peers:`, PEER_OVERRIDES[upper]);
    console.log('[peerResolver] returning:', JSON.stringify(PEER_OVERRIDES[upper]));
    return PEER_OVERRIDES[upper];
  }

  // 2. SIC fallback: find other tickers in the lazy sicCache with the same SIC
  const cik = cikBySymbol[upper];
  if (!cik) return [];

  let targetSic = null;
  try {
    const sicData = await fetchSubmissions(cik);
    targetSic = sicData?.sic;
  } catch (_) {
    return [];
  }
  if (!targetSic) return [];

  const peers = [];
  for (const [peerCik, entry] of sicCache.entries()) {
    if (entry.sic !== targetSic || peerCik === cik) continue;
    const found = tickerCache?.find((e) => e.cik === peerCik);
    if (found) peers.push(found.symbol);
    if (peers.length >= 7) break; // widen screening set to ~8 columns (target + 7)
  }
  console.log(`[resolvePeers] ${upper} → SIC fallback, sic=${targetSic}, peers:`, peers);
  console.log('[peerResolver] returning:', JSON.stringify(peers));
  return peers;
}

app.get('/api/peers/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log('[/api/peers] HIT for ticker:', req.params.ticker);
  console.log(`[/api/peers] request for ${ticker}`);
  try {
    await loadTickers();
    const peers = await resolvePeers(ticker);
    console.log('[/api/peers] resolver returned:', JSON.stringify(peers));
    console.log(`[/api/peers] responding for ${ticker} with ${peers.length} peers:`, peers);
    res.json({ peers });
  } catch (err) {
    console.error(`Peers [${ticker}]:`, err.message);
    res.json({ peers: [] });
  }
});

// ── Verified data endpoint ─────────────────────────────────────────────────────
const { lookup: verifiedLookup } = require('./server/services/verifiedLookup');

app.get('/api/verified/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    await loadTickers();
    const cik = cikBySymbol[ticker] || null;
    const result = await verifiedLookup(ticker, cik);
    res.json(result);
  } catch (err) {
    console.error(`[/api/verified] ${ticker}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Express 5 lazily creates the router and exposes it as `app.router` (no `_router`).
// Guard so route introspection never crashes startup across Express versions.
const _routerStack = app.router?.stack || app._router?.stack || [];
console.log('[server] routes mounted. Available routes:',
  _routerStack
    .filter(r => r.route)
    .map(r => Object.keys(r.route.methods).join(',') + ' ' + r.route.path)
);

app.listen(3001, () => console.log('Server running on port 3001'));
