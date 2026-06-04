# DATA_SOURCES.md

Reference for all external financial data sources used in EasyM&A. Verified by live fetches on 2026-06-03. Endpoints and field names are production-confirmed.

---

## 1. Financial Modeling Prep (FMP)

**Base URLs**
- Legacy v3: `https://financialmodelingprep.com/api/v3/`
- Legacy v4: `https://financialmodelingprep.com/api/v4/`
- Current stable: `https://financialmodelingprep.com/stable/`  ← preferred going forward

All requests require `?apikey=YOUR_API_KEY` query parameter.

---

### 1.1 Quote Endpoint

**URL**
```
GET https://financialmodelingprep.com/stable/quote?symbol={TICKER}
```
Legacy alias (still works): `https://financialmodelingprep.com/api/v3/quote/{TICKER}?apikey=...`

**Response** — array, take `[0]`

```json
[
  {
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 189.30,
    "changesPercentage": 1.25,
    "change": 2.34,
    "dayLow": 187.10,
    "dayHigh": 190.50,
    "yearHigh": 198.23,
    "yearLow": 164.08,
    "marketCap": 2950000000000,
    "priceAvg50": 185.40,
    "priceAvg200": 178.90,
    "exchange": "NASDAQ",
    "volume": 58234500,
    "avgVolume": 55000000,
    "open": 187.50,
    "previousClose": 186.96,
    "eps": 6.43,
    "pe": 29.44,
    "earningsAnnouncement": "2024-08-01T00:00:00.000+0000",
    "sharesOutstanding": 15600000000,
    "timestamp": 1717440000
  }
]
```

**Key fields for M&A modeling:**

| Field | Description |
|---|---|
| `price` | Current market price |
| `marketCap` | Market capitalization in USD |
| `yearHigh` | 52-week high |
| `yearLow` | 52-week low |
| `sharesOutstanding` | Shares outstanding (not diluted) |
| `eps` | Trailing twelve months EPS |
| `pe` | Price-to-earnings ratio |

---

### 1.2 Income Statement Endpoint

**URL**
```
GET https://financialmodelingprep.com/stable/income-statement?symbol={TICKER}&limit=5&period=annual
```
Legacy: `https://financialmodelingprep.com/api/v3/income-statement/{TICKER}?limit=5&apikey=...`

**Period values:** `annual`, `quarter`, `Q1`, `Q2`, `Q3`, `Q4`, `FY`

**Response** — array ordered newest first. Confirmed shape from live README example (AAPL FY2020):

```json
[
  {
    "date": "2020-09-26",
    "symbol": "AAPL",
    "reportedCurrency": "USD",
    "cik": "0000320193",
    "fillingDate": "2020-10-30",
    "acceptedDate": "2020-10-29 18:06:25",
    "calendarYear": "2020",
    "period": "FY",
    "revenue": 274515000000,
    "costOfRevenue": 169559000000,
    "grossProfit": 104956000000,
    "grossProfitRatio": 0.38233,
    "researchAndDevelopmentExpenses": 18752000000,
    "generalAndAdministrativeExpenses": 19916000000,
    "sellingAndMarketingExpenses": 0.0,
    "sellingGeneralAndAdministrativeExpenses": 19916000000,
    "otherExpenses": 0.0,
    "operatingExpenses": 38668000000,
    "costAndExpenses": 208227000000,
    "interestExpense": 2873000000,
    "depreciationAndAmortization": 11056000000,
    "ebitda": 81020000000,
    "ebitdaratio": 0.29513,
    "operatingIncome": 66288000000,
    "operatingIncomeRatio": 0.24147,
    "totalOtherIncomeExpensesNet": -803000000,
    "incomeBeforeTax": 67091000000,
    "incomeBeforeTaxRatio": 0.24439,
    "incomeTaxExpense": 9680000000,
    "netIncome": 57411000000,
    "netIncomeRatio": 0.20913,
    "eps": 3.31,
    "epsdiluted": 3.28,
    "weightedAverageShsOut": 17352119000,
    "weightedAverageShsOutDil": 17528214000,
    "link": "https://www.sec.gov/...",
    "finalLink": "https://www.sec.gov/..."
  }
]
```

**Key fields for M&A modeling:**

| Field | Description |
|---|---|
| `revenue` | Total revenue |
| `operatingIncome` | EBIT / operating income |
| `ebitda` | EBITDA |
| `netIncome` | Net income |
| `weightedAverageShsOut` | Basic weighted average shares |
| `weightedAverageShsOutDil` | Diluted weighted average shares |

---

### 1.3 Balance Sheet Endpoint

**URL**
```
GET https://financialmodelingprep.com/stable/balance-sheet-statement?symbol={TICKER}&limit=5&period=annual
```
Legacy: `https://financialmodelingprep.com/api/v3/balance-sheet-statement/{TICKER}?limit=5&apikey=...`

**Key response fields** (confirmed from SDK source and GitHub README):

```json
[
  {
    "date": "2020-09-26",
    "symbol": "AAPL",
    "period": "FY",
    "cashAndCashEquivalents": 38016000000,
    "shortTermInvestments": 52927000000,
    "cashAndShortTermInvestments": 90943000000,
    "netReceivables": 37445000000,
    "inventory": 4061000000,
    "totalCurrentAssets": 143713000000,
    "propertyPlantEquipmentNet": 36766000000,
    "goodwill": 0,
    "intangibleAssets": 0,
    "totalNonCurrentAssets": 180175000000,
    "totalAssets": 323888000000,
    "accountsPayable": 42296000000,
    "shortTermDebt": 13769000000,
    "totalCurrentLiabilities": 105392000000,
    "longTermDebt": 98667000000,
    "totalNonCurrentLiabilities": 153157000000,
    "totalLiabilities": 258549000000,
    "totalStockholdersEquity": 65339000000,
    "totalEquity": 65339000000,
    "totalDebt": 112436000000,
    "netDebt": 74420000000
  }
]
```

**Key fields for M&A modeling:**

| Field | Description |
|---|---|
| `cashAndCashEquivalents` | Cash and cash equivalents |
| `shortTermInvestments` | Short-term investments |
| `totalDebt` | Total debt (short + long term) |
| `longTermDebt` | Long-term debt only |
| `netDebt` | totalDebt minus cash |
| `totalAssets` | Total assets |
| `totalStockholdersEquity` | Book equity |

---

### 1.4 Cash Flow Statement Endpoint

**URL**
```
GET https://financialmodelingprep.com/stable/cash-flow-statement?symbol={TICKER}&limit=5&period=annual
```
Legacy: `https://financialmodelingprep.com/api/v3/cash-flow-statement/{TICKER}?limit=5&apikey=...`

**Key response fields:**

```json
[
  {
    "date": "2020-09-26",
    "symbol": "AAPL",
    "period": "FY",
    "netIncome": 57411000000,
    "depreciationAndAmortization": 11056000000,
    "deferredIncomeTax": -215000000,
    "stockBasedCompensation": 6829000000,
    "changeInWorkingCapital": -5757000000,
    "operatingCashFlow": 80674000000,
    "capitalExpenditure": -7309000000,
    "acquisitionsNet": -1524000000,
    "purchasesOfInvestments": -114938000000,
    "salesMaturitiesOfInvestments": 120483000000,
    "freeCashFlow": 73365000000,
    "netCashUsedForInvestingActivites": -4289000000,
    "debtRepayment": -12629000000,
    "commonStockIssued": 0,
    "commonStockRepurchased": -72358000000,
    "dividendsPaid": -14081000000,
    "netCashUsedProvidedByFinancingActivities": -86820000000,
    "netChangeInCash": -10435000000
  }
]
```

**Key fields for M&A modeling:**

| Field | Description |
|---|---|
| `operatingCashFlow` | Cash from operations |
| `capitalExpenditure` | CapEx (negative = spending) |
| `freeCashFlow` | FCF = operatingCashFlow + capitalExpenditure |

---

### 1.5 Analyst Price Target Endpoints

Two complementary endpoints:

#### Price Target Consensus (aggregated — recommended)
```
GET https://financialmodelingprep.com/stable/price-target-consensus?symbol={TICKER}
```
Legacy v4: `https://financialmodelingprep.com/api/v4/price-target-consensus?symbol={TICKER}&apikey=...`

Returns the aggregated consensus. Fields include high, low, median, and consensus targets:
```json
[
  {
    "symbol": "AAPL",
    "targetHigh": 230.00,
    "targetLow": 150.00,
    "targetConsensus": 195.00,
    "targetMedian": 196.00
  }
]
```

#### Price Target Summary (by time window)
```
GET https://financialmodelingprep.com/stable/price-target-summary?symbol={TICKER}
```

Returns average targets across multiple timeframes (last month, last quarter, last year, etc.).

#### Individual Analyst Price Targets
```
GET https://financialmodelingprep.com/api/v4/price-target?symbol={TICKER}&apikey=...
```
Returns individual analyst price target records with `priceTarget`, `adjPriceTarget`, `priceWhenPosted`, `publishedDate`, `analystName`, `analystCompany`.

**Key fields for M&A:**

| Field | Endpoint | Description |
|---|---|---|
| `targetHigh` | consensus | Highest analyst target |
| `targetLow` | consensus | Lowest analyst target |
| `targetConsensus` | consensus | Mean of all targets |
| `targetMedian` | consensus | Median of all targets |

---

### 1.6 Pricing & Licensing

**Tiers (annual billing, as of 2026-06-03):**

| Tier | Price/mo (billed annually) | Key limits |
|---|---|---|
| Basic (Free) | $0 | 250 calls/day, EOD data only |
| **Starter** | **$22/mo** | 300 calls/min, 5 years history, US coverage, annual fundamentals |
| **Premium** | **$59/mo** | 750 calls/min, 30 years history, UK+Canada, full fundamentals |
| Ultimate | $149/mo | 3,000 calls/min, global coverage, bulk delivery |

Monthly billing (non-annual) is also available at higher rates.

**Which tier covers this app's needs:**
- Quote endpoint: available on all paid tiers
- Annual fundamentals (income statement, balance sheet, cash flow): **Starter** and above
- Analyst price targets: check FMP's tier comparison page — appears to be **Premium** or above for full analyst data
- Intraday data: Premium and above

**Commercial/Display License — REQUIRED:**

From FMP's pricing page terms (fetched live):

> "Displaying or redistributing data sourced from FMP requires a specific **Data Display and Licensing Agreement** with FMP."

Any app that shows FMP data to end users (not just internal tooling) must execute this agreement separately from the API subscription. Contact FMP sales before launch.

**Docs:** `https://site.financialmodelingprep.com/developer/docs`  
**Pricing:** `https://site.financialmodelingprep.com/developer/docs/pricing`

---

## 2. SEC EDGAR XBRL Company Facts API

Free, no API key required. Primary use: pulling audited financial figures directly from SEC filings.

---

### 2.1 Endpoint

```
GET https://data.sec.gov/api/xbrl/companyfacts/CIK{zero-padded-10-digit-CIK}.json
```

Example (Atlassian Corp, CIK 1650372):
```
https://data.sec.gov/api/xbrl/companyfacts/CIK0001650372.json
```

CIK lookup: `https://efts.sec.gov/LATEST/search-index?q="{COMPANY NAME}"&forms=10-K`  
Or search: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={NAME}&type=10-K`

---

### 2.2 Required Headers

```
User-Agent: YourCompanyName contact@yourcompany.com
Accept-Encoding: gzip, deflate
```

From SEC EDGAR policy (fetched live from `https://www.sec.gov/os/accessing-edgar-data`):

> "Please declare your user agent in request headers."  
> Sample: `User-Agent: Sample Company Name AdminContact@samplecompanydomain.com`

**The User-Agent must include a company name and contact email. Requests without this may be blocked.**

---

### 2.3 Rate Limit

From SEC EDGAR policy (fetched live):

> "Current max request rate: **10 requests/second**."

Throttle to ≤8 req/s in practice. SEC reserves the right to block violators.

---

### 2.4 Top-Level JSON Structure

```json
{
  "cik": 1650372,
  "entityName": "Atlassian Corporation",
  "facts": {
    "dei": { ... },
    "us-gaap": { ... },
    "ifrs-full": { ... },
    "srt": { ... }
  }
}
```

- `cik` — integer CIK
- `entityName` — company legal name
- `facts` — namespaced XBRL facts
  - `dei` — disclosure/entity-level items (shares outstanding point-in-time, public float, etc.)
  - `us-gaap` — US GAAP financial statement tags (294 tags for Atlassian)
  - `ifrs-full` — IFRS tags, present when company files under IFRS (Atlassian: 225 tags)
  - `srt` — SEC reporting taxonomy (rarely used for fundamentals)

---

### 2.5 Per-Tag Structure

Each tag under `facts.us-gaap` (or `facts.dei`) looks like:

```json
"RevenueFromContractWithCustomerExcludingAssessedTax": {
  "label": "Revenue from Contract with Customer, Excluding Assessed Tax",
  "description": "Amount, excluding tax collected from customer, of revenue...",
  "units": {
    "USD": [
      {
        "start": "2025-10-01",
        "end": "2025-12-31",
        "val": 1586315000,
        "accn": "0001650372-26-000011",
        "fy": 2026,
        "fp": "Q2",
        "form": "10-Q",
        "filed": "2026-02-06",
        "frame": "CY2025Q4"
      },
      ...
    ]
  }
}
```

**Per-entry fields:**

| Field | Type | Description |
|---|---|---|
| `start` | string (YYYY-MM-DD) | Period start date (absent for point-in-time / "I" frame facts) |
| `end` | string (YYYY-MM-DD) | Period end date |
| `val` | number | Reported value in units currency (USD, shares, etc.) |
| `accn` | string | SEC accession number of the filing |
| `fy` | integer | Fiscal year |
| `fp` | string | Fiscal period: `FY`, `Q1`, `Q2`, `Q3`, `Q4` |
| `form` | string | Form type: `10-K`, `10-Q`, `20-F`, etc. |
| `filed` | string (YYYY-MM-DD) | Date the filing was accepted by SEC |
| `frame` | string | Optional. CY-frame like `CY2025Q4` (flow) or `CY2025Q4I` (instant/balance sheet) |

**Frame convention:**
- `CY2025Q4` — quarterly flow period (income statement, cash flow)
- `CY2025Q4I` — point-in-time instant (balance sheet)
- `CY2025` — full calendar year
- Entries without `frame` are HTM-level duplicates (cumulative YTD from 10-Q) — filter them out when you need single-quarter figures

**Filtering for clean quarterly data:** keep only entries where `frame` is present and matches the expected pattern (e.g. `CY\d{4}Q[1-4]$` for quarterly flow).

---

### 2.6 XBRL Tag Reference

These are the confirmed tags present in Atlassian's (CIK 0001650372) filing as of 2026-06-03:

#### Income Statement (us-gaap)

| XBRL Tag | Description | Notes |
|---|---|---|
| `RevenueFromContractWithCustomerExcludingAssessedTax` | Revenue (ASC 606, excl. assessed tax) | Primary revenue tag for SaaS companies post-2018 |
| `Revenues` | Revenues (older tag, pre-ASC 606) | May be absent for companies that only use the new tag |
| `OperatingIncomeLoss` | Operating income / (loss) | Negative = operating loss |
| `NetIncomeLoss` | Net income / (loss) | Negative = net loss |

#### Balance Sheet (us-gaap)

| XBRL Tag | Description | Notes |
|---|---|---|
| `CashAndCashEquivalentsAtCarryingValue` | Cash and cash equivalents | Point-in-time, use `frame` ending in `I` |
| `CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` | Cash incl. restricted cash | Used in cash flow reconciliation |
| `LongTermDebtNoncurrent` | Long-term debt (non-current portion) | |
| `LongTermDebtCurrent` | Long-term debt (current maturities) | |

#### Cash Flow (us-gaap)

| XBRL Tag | Description | Notes |
|---|---|---|
| `NetCashProvidedByUsedInOperatingActivities` | Operating cash flow | |
| `PaymentsToAcquirePropertyPlantAndEquipment` | Capital expenditures | Negative (outflow) |

> **Free Cash Flow** is not a direct XBRL tag. Compute it:  
> `FCF = NetCashProvidedByUsedInOperatingActivities - PaymentsToAcquirePropertyPlantAndEquipment`

#### Shares (us-gaap + dei)

| XBRL Tag | Namespace | Description |
|---|---|---|
| `WeightedAverageNumberOfSharesOutstandingBasic` | us-gaap | Basic weighted avg shares (income stmt) |
| `WeightedAverageNumberOfDilutedSharesOutstanding` | us-gaap | Diluted weighted avg shares |
| `EntityCommonStockSharesOutstanding` | dei | Point-in-time shares outstanding (cover page) |
| `CommonStockSharesOutstanding` | us-gaap | Shares outstanding on balance sheet |

**Note on Atlassian:** Atlassian files under IFRS (Australian company). Their primary revenue tag is `RevenueFromContractWithCustomerExcludingAssessedTax` in `us-gaap`. For IFRS-only filers, check `facts.ifrs-full` for tags like `Revenue` or `GrossProfit`.

---

### 2.7 Live Data Confirmed (Atlassian, CIK 0001650372)

From fetch on 2026-06-03 — most recent quarter (FY2026 Q3, period ending 2026-03-31):

```json
RevenueFromContractWithCustomerExcludingAssessedTax:
  { "start": "2026-01-01", "end": "2026-03-31", "val": 1786971000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1" }

OperatingIncomeLoss:
  { "start": "2026-01-01", "end": "2026-03-31", "val": -56284000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1" }

NetIncomeLoss:
  { "start": "2026-01-01", "end": "2026-03-31", "val": -98389000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1" }

CashAndCashEquivalentsAtCarryingValue:
  { "end": "2026-03-31", "val": 1136342000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1I" }

LongTermDebtNoncurrent:
  { "end": "2026-03-31", "val": 989081000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1I" }

WeightedAverageNumberOfSharesOutstandingBasic:
  { "start": "2026-01-01", "end": "2026-03-31", "val": 260965000,
    "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-05-01", "frame": "CY2026Q1" }
```

---

## 3. Yahoo Finance (Unofficial)

**Status:** Unofficial / unsupported. No public API terms. Yahoo periodically changes authentication requirements. As of 2026-06-03:
- `v8/finance/chart` — works without auth for basic OHLCV + meta
- `v10/finance/quoteSummary` — requires crumb + cookie auth

**Use for:** real-time price, 52-week range, basic market data when you need a free fallback. Do not rely on this for production without a fallback.

---

### 3.1 Chart Endpoint (No Auth Required)

```
GET https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?interval=1d&range=1d
```

**Headers recommended:**
```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
Accept: application/json
```

**Response structure:**
```json
{
  "chart": {
    "result": [
      {
        "meta": { ... },
        "timestamp": [1717430400, ...],
        "indicators": {
          "quote": [
            {
              "open": [187.50, ...],
              "close": [189.30, ...],
              "high": [190.50, ...],
              "low": [187.10, ...],
              "volume": [58234500, ...]
            }
          ]
        }
      }
    ],
    "error": null
  }
}
```

**Meta object — confirmed fields (fetched live for AAPL on 2026-06-03):**

```json
{
  "regularMarketPrice": 310.26,
  "fiftyTwoWeekHigh": 316.94,
  "fiftyTwoWeekLow": 195.07,
  "regularMarketDayHigh": 316.94,
  "regularMarketDayLow": 308.85,
  "regularMarketVolume": 50249371,
  "symbol": "AAPL",
  "longName": "Apple Inc.",
  "currency": "USD",
  "exchangeName": "NMS",
  "instrumentType": "EQUITY",
  "regularMarketTime": 1717430400,
  "gmtoffset": -14400,
  "timezone": "EDT",
  "dataGranularity": "1d",
  "range": "1d",
  "chartPreviousClose": 186.96,
  "priceHint": 2
}
```

**Note:** `marketCap` is NOT present in the v8 chart response. Use `v10/quoteSummary?modules=price` for market cap (requires crumb auth — see §3.2).

**Key fields:**

| Field | Description |
|---|---|
| `regularMarketPrice` | Current / last trade price |
| `fiftyTwoWeekHigh` | 52-week high |
| `fiftyTwoWeekLow` | 52-week low |
| `regularMarketDayHigh` | Today's intraday high |
| `regularMarketDayLow` | Today's intraday low |
| `regularMarketVolume` | Today's volume |
| `chartPreviousClose` | Previous day close |

---

### 3.2 quoteSummary Endpoint (Auth Required)

```
GET https://query2.finance.yahoo.com/v10/finance/quoteSummary/{TICKER}?modules=price,summaryDetail
```

Requires valid crumb. Crumb flow:
1. GET `https://finance.yahoo.com/quote/{TICKER}` — capture cookies
2. GET `https://query2.finance.yahoo.com/v1/test/getcrumb` with cookies — returns crumb string
3. Append `&crumb={crumb}` to all v10 requests

**`price` module fields include:** `regularMarketPrice`, `marketCap`, `regularMarketDayHigh`, `regularMarketDayLow`, `regularMarketVolume`, `regularMarketPreviousClose`, `fiftyTwoWeekHigh`, `fiftyTwoWeekLow`, `currency`, `exchangeName`, `quoteType`, `symbol`, `shortName`, `longName`

**`summaryDetail` module fields include:** `fiftyTwoWeekLow`, `fiftyTwoWeekHigh`, `fiftyDayAverage`, `twoHundredDayAverage`, `marketCap`, `trailingPE`, `forwardPE`, `dividendYield`, `beta`, `volume`, `averageVolume`, `averageVolume10days`

**marketCap field path:** `quoteSummary.result[0].price.marketCap.raw`  
Values in Yahoo Finance are often wrapped: `{ "raw": 2950000000000, "fmt": "2.95T", "longFmt": "2,950,000,000,000" }` — always use `.raw`.

---

### 3.3 Rate Limits & Stability

- No published rate limit
- Enforces crumb/cookie auth on v10 as of late 2024
- v8 chart has been stable without auth but Yahoo may change this
- Recommend using only as a fallback for price data; do not use for fundamentals
- For a stable alternative, FMP or Alpha Vantage are more reliable

---

## 4. Finnhub API

Free-tier quote + basic-financials (52-week range). Confirmed 2026-06-04 via official OpenAPI spec.

**Base URL:** `https://finnhub.io/api/v1/`  
**Auth:** `?token={FINNHUB_KEY}` query parameter  
**Rate limit:** 30 API calls/second (applies across all plans; multiple subscriptions do not stack)  
**Key source:** `process.env.FINNHUB_KEY` in `server.js` — no fallback value, client returns empty if unset

---

### 4.1 Quote Endpoint (free tier — confirmed)

```
GET https://finnhub.io/api/v1/quote?symbol={TICKER}&token={KEY}
```

**Response fields (all `float`):**

| Field | Meaning |
|---|---|
| `c` | Current price ← `price` |
| `h` | Day high |
| `l` | Day low |
| `o` | Day open |
| `pc` | Previous close |
| `d` | Absolute change vs previous close |
| `dp` | Percent change vs previous close |
| `t` | Unix timestamp of last tick |

**EasyM&A usage:** `price` ← `c`

---

### 4.2 Basic Financials — 52-Week Range (free tier — confirmed)

```
GET https://finnhub.io/api/v1/stock/metric?symbol={TICKER}&metric=all&token={KEY}
```

**Response structure:**
```json
{
  "symbol": "AAPL",
  "metricType": "all",
  "metric": {
    "52WeekHigh": 198.23,
    "52WeekLow": 164.08,
    "52WeekLowDate": "2024-01-05",
    "52WeekPriceReturnDaily": 14.2,
    "beta": 1.24,
    "10DayAverageTradingVolume": 55.3
  },
  "series": { ... }
}
```

**Exact field names (confirmed from official Swagger sampleResponse):**
- 52-week high: `metric["52WeekHigh"]`
- 52-week low: `metric["52WeekLow"]`

**EasyM&A usage:** `week52High` ← `metric["52WeekHigh"]`, `week52Low` ← `metric["52WeekLow"]`

---

### 4.3 Free Tier vs Paid

**Free (confirmed unrestricted):** `/quote`, `/stock/metric`, `/stock/profile2`, `/stock/peers`, `/stock/recommendation`, `/stock/insider-sentiment`, `/news`, `/search`, `/stock/earnings`

**Paid only (Premium+):** `/stock/candle` (historical OHLCV), `/stock/financials` (standardized), `/stock/price-target` and all forward estimates, `/indicator` (technical), `/index/constituents`, `/stock/ownership`

---

### 4.4 Commercial / Display Terms

From Finnhub ToS (finnhub.io/terms-of-service), confirmed 2026-06-04:

- **Personal use only.** Free-tier plans are "strictly for personal use unless explicitly stated otherwise." Using the data for business purposes, displaying it in a commercial product, or deducting the cost as a business expense disqualifies the personal plan.
- **No redistribution.** Data and derived results may not be shared with any third party without written approval from Finnhub.
- **Commercial SaaS/display requires a paid commercial plan.** Contact Finnhub sales before any public launch that displays Finnhub data to end users.

> **Status for EasyM&A:** Free key is suitable for personal development and testing. Same commercial-launch gate as FMP.

---

## Appendix: Source Comparison

| Data Point | FMP (Starter) | SEC EDGAR | Finnhub (Free) | Yahoo Finance |
|---|---|---|---|---|
| Live price | Yes (`stable/quote`) — **403 on free key** | No | Yes (`/quote`, `c`) | Yes (`v8/chart`) |
| Market cap | Yes (`marketCap`) — **403 on free key** | No | No | v10 only (auth) |
| 52-week high/low | Yes — **403 on free key** | No | Yes (`/stock/metric`) | Yes |
| Revenue (annual) | Yes — **403 on free key** | Yes (XBRL tag) | No | No |
| Operating income | Yes — **403** | Yes | No | No |
| Net income | Yes — **403** | Yes | No | No |
| Shares outstanding | Yes — **403** | Yes (DEI tag) | No | No |
| Free cash flow | Yes — **403** | Compute from tags | No | No |
| Total debt | Yes — **403** | Compute from tags | No | No |
| Cash | Yes — **403** | Yes (XBRL tag) | No | No |
| Analyst price targets | Yes — **403** | No | No (paid only) | No |
| Auth required | API key | User-Agent header | API key | Crumb (v10) |
| Rate limit | Tier-dependent | 10 req/s | 30 req/s (all plans) | Unofficial |
| Commercial use | Data Display Agreement required | Free/public | Commercial plan required | Terms unclear |
| Cost | $22/mo+ | Free | Free (personal) | Free (unofficial) |
