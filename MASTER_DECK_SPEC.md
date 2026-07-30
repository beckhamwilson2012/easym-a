# EASYM&A MASTER DECK SPECIFICATION
## Reference: Salesforce-acquires-Atlassian Merger Model Deck
### Version: Master v3 (June 16, 2026) — the canonical quality bar for all EasyM&A output

---

## 0. HOW TO READ THIS FILE

This is the **single source of truth** for what an EasyM&A-generated merger deck must look like.
Every generated deck (any acquirer/target pair) must reproduce this **structure, slide order,
formatting conventions, basis-labeling rules, and sourcing discipline** — only the underlying
company data changes.

Notation used below:
- `[VERIFIED]`  = figure confirmed against a primary source (SEC filing / earnings release / live market data). Reproduce method, not the literal number, for other deals.
- `[COMPUTED]`  = derived from verified inputs by formula (formula given).
- `[ESTIMATE]`  = analyst consensus or labeled projection; must carry an "(est)" or "E" marker.
- `[ASSUMPTION]`= illustrative transaction input set by the user/model; must be labeled "illustrative."
- `⚠ FIX`       = an inconsistency in the current master PDF that MUST be corrected and must NOT be reproduced in generated decks. The corrected value is given.

Currency: all financials in **$ millions** unless a cell explicitly shows $B or $/share.
Negative numbers: render in **(parentheses)**, never with a leading minus that could be read as a formula.
Percentages: whole numbers on summary slides; one decimal only where precision matters (e.g. 34.1%).
EPS: always **two decimals** ($7.80, never "8").

---

## 1. DECK-WIDE CONVENTIONS (apply to every slide)

### 1.1 Basis labeling (CRITICAL — this is the #1 correctness rule)
The deck mixes GAAP and non-GAAP. Every financial slide MUST state its basis in the
sub-header, and the basis must be internally consistent within the deal narrative:

- **Standalone P&L slides** → GAAP, labeled "(GAAP, $ in millions, calendar year)".
- **Pro forma / accretion / contribution slides** → NON-GAAP, labeled "(Non-GAAP)".
- **The accretion/dilution headline is decided on the NON-GAAP basis.**
  On non-GAAP the target (Atlassian) is profitable → deal is **ACCRETIVE (+8.0% CY2026E / +11.3% CY2027E)**.
  On GAAP the target shows net losses → deal would be dilutive.
  THE DECK'S HEADLINE = ACCRETIVE (non-GAAP). Any slide implying dilution is a defect to fix.

### 1.2 Calendarization
Companies with different fiscal year-ends MUST be restated to a common **calendar year** before
combination. Method:
- January FYE (e.g. Salesforce): FY(n) ending Jan ≈ CY(n-1); summing the 4 fiscal quarters ≈ calendar year (one-month stub immaterial). CY label required.
- June FYE (e.g. Atlassian): fiscal year straddles two calendar years; MUST rebuild calendar years by summing actual Jan–Dec quarters (Mar+Jun+Sep+Dec). This materially changes the numbers; do not shortcut.
- Pro forma combination is ONLY valid on a common calendar basis.

### 1.3 Sourcing discipline
- Every figure traces to: SEC filing (primary), earnings release/8-K, live market data, analyst consensus (S&P Global/MarketScreener), or labeled illustrative assumption.
- Market caps are COMPUTED as (latest-filed shares outstanding × current price), NEVER taken from aggregators (they disagree wildly due to stale share counts / buybacks).
- EV = market cap + total debt − (cash + marketable securities), all from the same filing.
- Forward profit lines are NON-GAAP (that is the only basis analysts publish); do not mix into GAAP actuals.
- Every data-driven slide carries a Sources/basis footnote (see Slide 15 template).
- "as of" date must be the actual data-pull date, consistent across the deck.

### 1.4 Formatting
- $ in millions on all P&L; $B only on market-cap/EV/deal-value summary lines.
- Negatives in (parentheses). No leading "+" or "=" in any cell (Google Sheets reads it as a formula → #ERROR!). If a "+" sign is wanted, prefix with apostrophe or format cell as text.
- Percentages rounded to whole numbers on summary slides.
- EPS to two decimals.
- "n/m" for not-meaningful ratios (e.g. P/E on a loss-making company); "n/d" for not-disclosed.

---

## 2. SLIDE-BY-SLIDE SPECIFICATION (14 content slides + sources)

### SLIDE 1 — TITLE
```
Title:      {ACQUIRER} Acquires {TARGET}
Subtitle:   Easy M&A
Footer:     Prepared using EasyM&A with AI assistance. Financial data sourced from
            SEC filings, company disclosures, and public market data (as of {DATA_DATE}).
```
⚠ FIX: master shows "as of June 1, 2026" but verified data is as of **June 12, 2026**. DATA_DATE must match the actual pull date used throughout the deck. Do not hard-code June 1.

---

### SLIDE 2 — POTENTIAL ACQUISITION TARGETS (DASHBOARD)
Screening table. Metrics as ROWS, ~8 companies as COLUMNS (acquirer first, target second, then ~6 peers).
Sub-header: "LTM operating data · market data as of {DATA_DATE}"

Rows (in order):
```
Revenue ($M)                 [VERIFIED] latest filing / TTM
Revenue Growth (proj.)       [ESTIMATE] forward consensus — label (proj.)
Gross Margin                 [VERIFIED] from income statement
Op Margin (NG)               [VERIFIED] non-GAAP, from 8-K/release
Op Income ($M, NG)           [COMPUTED] = Op Margin × Revenue
Net Revenue Retention        [VERIFIED] where disclosed; "n/d" otherwise
Market Cap                   [COMPUTED] shares × price; $B; ONE decimal, no tilde
Employees                    [VERIFIED] latest 10-K headcount
Customers                    [VERIFIED] latest disclosure
EV / Revenue (proj.)         [COMPUTED] EV ÷ revenue — label (proj.)
EPS Impact if Acquired       [COMPUTED] illustrative per-target accretion/dilution
```

Reference values (Salesforce/Atlassian deal, verified June 2026):
```
                  Salesforce  Atlassian  ServiceNow  Workday  HubSpot  Monday  GitLab  Asana
Revenue ($M)         41,525      6,190      13,960     9,552    3,500   1,232   1,050    770
Rev Growth (proj.)     10%        18%         22%       13%      18%     24%     17%      9%
Gross Margin           78%        84%         77%       76%      85%     90%     89%     89%
Op Margin (NG)        34.1%      20.8%       31.0%     30.6%    18.6%   13.0%   17.0%    6.0%
Op Income ($M,NG)    14,160      1,287       4,330     2,930     650     165     180      45
Net Rev Retention     n/d        115%         98%      n/d      104%    114%    118%     96%
Market Cap          $136.0B     $22.0B     $106.0B   $30.0B   $10.1B  $4.3B   $3.3B   $1.3B
Employees           83,334     13,813      26,000    20,000    9,000   3,155   2,500   1,819
Customers          150,000+   350,000+      8,400    11,000  247,000 245,000 10,500 150,000+
EV/Revenue (proj.)    4.3x       4.7x        8.3x      6.0x     2.6x    2.6x    2.6x    3.0x
EPS Impact if Acq.     —       (18.7%)     (43.2%)   (14.9%)   (5.7%)  (1.8%)  (2.2%)  (4.5%)
```
⚠ FIX (BASIS CONSISTENCY): The "EPS Impact if Acquired" row here is on a GAAP/no-synergy basis, so the target shows **(18.7%) dilutive** — this CONTRADICTS the deck's accretive headline (slide 8, non-GAAP). Resolution options Claude Code must implement ONE of:
  (a) recompute this row on the SAME non-GAAP basis as slide 8 (→ target becomes accretive), OR
  (b) clearly relabel the row "Illustrative GAAP, pre-synergy" so the basis difference is explicit.
  Default: option (a) for consistency.
⚠ FIX (market cap): Salesforce market cap on this slide ($136.0B) uses 819M shares (pre-ASR). Slide 3/8 use post-ASR 868M shares → $144.1B. PICK ONE post-ASR figure ($144.1B) and use it on EVERY slide. (CRM did a $25B debt-funded ASR; 103M shares retired; non-current debt rose to $39.28B.)

---

### SLIDE 3 — COMPANY PROFILES: {ACQUIRER} vs {TARGET}
Combined qualitative + key-financials profile. Two company columns.
Sub-header for financials block: "(GAAP, CY2025, $M)"

QUALITATIVE block (rows):
```
Founded, CEO, HQ, Employees, Business, Customer profile, Go-to-market, Core products
```
Reference (verified):
```
                Salesforce (CRM)                          Atlassian (TEAM)
Founded         1999, San Francisco                       2002, Sydney
CEO             Marc Benioff                              Mike Cannon-Brookes
HQ              San Francisco, CA                         Sydney, Australia
Employees       83,334                                    13,813
Business        CRM platform — sales, service, marketing  Developer collaboration & team productivity
Customer prof.  150K+ customers; 90% of Fortune 500       350K+ customers; 80% of Fortune 500
Go-to-market    Top-down enterprise sales                 Bottom-up product-led adoption
Core products   Sales/Service/Marketing Cloud, Slack,     Jira, Confluence, Bitbucket, Trello,
                Tableau, Agentforce                       Loom, Rovo
```
KEY FINANCIALS block (GAAP, CY2025, $M):
```
                       Salesforce   Atlassian
Revenue                  41,525       5,760
Revenue growth            10%          20%
Gross margin              78%          84%
Operating margin (GAAP)   20%          (3%)
Free cash flow           14,400       1,200
Market cap              $144.1B      $24.0B
Enterprise value        $171.5B      $24.1B
EV / Revenue             4.1x         4.2x
```
NOTE: employees 83,334 / 13,813 and customers 350K+ are the VERIFIED corrected values (older decks showed 76,000 / 12,200 / 300K — those are stale, do not use).

---

### SLIDE 4 — HISTORICAL & PROJECTED P&L — {ACQUIRER}
Standalone P&L. GAAP. $ in millions. Calendar years.
Sub-header: "(GAAP, $ in millions)"
Columns: CY2023 · CY2024 · CY2025 · CY2026E · CY2027E
Rows: Total Revenue, Cost of Revenue, Gross Profit, Operating Expense, Operating Income,
      Net Income, EBITDA, Diluted Shares (M), GAAP EPS
Then MARGINS & GROWTH: Revenue Growth %, Gross Margin %, Operating Margin %, EBITDA Margin %, Net Margin %

Reference (Salesforce, verified):
```
                  CY2023  CY2024  CY2025  CY2026E  CY2027E
Total Revenue     34,857  37,895  41,525   46,069   50,328
Cost of Revenue    8,541   8,643   9,270      —        —
Gross Profit      26,316  29,252  32,255      —        —
Operating Expense 21,305  22,047  23,924      —        —
Operating Income   5,011   7,205   8,331      —        —
Net Income         4,136   6,197   7,457      —        —
EBITDA            10,895  12,777  14,159      —        —
Diluted Shares(M)    984     974     956      —        —
GAAP EPS           4.20    6.36    7.80      —        —
Revenue Growth %     —       9%     10%      11%       9%
Gross Margin %      75%     77%     78%       —        —
Operating Margin %  14%     19%     20%       —        —
EBITDA Margin %     31%     34%     34%       —        —
Net Margin %        12%     16%     18%       —        —
```
RULES embodied here (apply to all standalone P&Ls):
- Line-level detail stops at the last ACTUAL year; only Revenue (+growth) extends to projected years (because revenue is GAAP=non-GAAP-equal and consensus-verifiable; projected GAAP profit detail is NOT publicly available, so leave "—" rather than fabricate).
- ⚠ FIX: master shows GAAP EPS as "4, 6, 8" — WRONG, rounds away cents. Must be **4.20 / 6.36 / 7.80**.
- Projected revenue from analyst consensus (MarketScreener/S&P Global), calendar-adjusted. Growth shape must be defensible (bump then decelerate is normal; accelerating out-year growth for a mega-cap is a red flag to avoid).

---

### SLIDE 5 — HISTORICAL & PROJECTED P&L — {TARGET}
Same structure/rows as Slide 4. GAAP. Calendar years. MUST match Slide 4 row-for-row.
Target with non-January FYE requires true calendar rebuild from quarters (see 1.2).

Reference (Atlassian, verified/rebuilt from SEC quarters):
```
                  CY2023  CY2024  CY2025   CY2026E      CY2027E
Total Revenue      3,893   4,794   5,760  7,065 (est)  8,478 (est)
Cost of Revenue      701     863     922      —            —
Gross Profit       3,192   3,931   4,838      —            —
Operating Expense  3,444   4,069   5,023      —            —
Operating Income   (252)   (138)   (185)      —            —
Net Income         (234)   (346)   (189)      —            —
EBITDA             (212)    (93)   (135)      —            —
Diluted Shares(M)    255     258     261      —            —
GAAP EPS          (0.92)  (1.34)  (0.72)      —            —
Revenue Growth %     —      23%     20%    23% (est)    20% (est)
Gross Margin %      82%     82%     84%       —            —
Operating Margin %  (6%)    (3%)    (3%)      —            —
EBITDA Margin %     (5%)    (2%)    (2%)      —            —
Net Margin %        (6%)    (7%)    (3%)      —            —
```
NOTES:
- Negatives in parentheses (Atlassian is GAAP-unprofitable — this is correct and is WHY the GAAP deal looks dilutive while non-GAAP looks accretive).
- CY2026E uses verified Q3-FY26 actual ($1,786.97M Mar-2026 quarter, a 32% beat) + estimated quarters. CY2027E uses management's stated ~20% growth target — both labeled "(est)".
- Cost of Revenue/OPEX/EBITDA/EPS are COMPUTED from verified margins + reconstructed D&A; flag as reconstructed where applicable.

---

### SLIDE 6 — PRO FORMA COMBINED FINANCIALS — PROJECTED
Title: "Pro Forma Combined Financials — Projected"
Basis: NON-GAAP. Matrix layout.
Top group-headers: CY2026E and CY2027E, each spanning 5 sub-columns:
  Salesforce · Atlassian · Combined · Synergies · PF Total
Rows: Revenue, Revenue growth, Gross Profit, Gross margin %, Operating Expense,
      EBIT (Operating Income), Operating margin %, Net Income
(EPS row optional — only fillable once deal terms set; see Slide 8.)

Reference (verified non-GAAP):
```
                         CY2026E                                CY2027E
              SF      TEAM   Comb   Syn   PF Total | SF      TEAM   Comb   Syn   PF Total
Revenue       46,069  7,065  53,134  190  53,324  | 50,328  8,478  58,806  285  59,091
Rev growth     11%    23%    12%     —    13%      |  9%     20%    11%     —    11%
Gross Profit  35,934  5,935  41,868  185  42,053  | 39,256  7,122  46,377  278  46,655
Gross margin   78%    84%    79%     —    79%      | 78%     84%    79%     —    79%
Op Expense   (19,810)(4,168)(23,978) 750 (23,228) |(21,138)(4,832)(25,970)1,122 (24,848)
EBIT          16,124  1,766  17,890  935  18,825  | 18,118  2,289  20,407 1,400  21,807
Op margin %    35%    25%    34%     —    35%      | 36%     27%    35%     —    37%
Net Income    12,738  1,395  14,133  —   14,872   | 14,313  1,808  16,122  —    17,228
```
Synergies: illustrative ($935M CY2026E → $1,400M CY2027E run-rate). Split: OPEX $560M, COGS $185M, Rev $190M (illustrative).
FOOTNOTE (required, verbatim style):
"Sources: $M, non-GAAP. Revenue from analyst consensus (S&P Global/MarketScreener) and company
guidance; margins from SEC filings (8-K) and analyst estimates. Synergies are illustrative
transaction assumptions. CY2026E–27E are projections. Market/analyst data as of {DATA_DATE}."

---

### SLIDE 7 — ⚠⚠ DEFECTIVE IN MASTER — MUST BE REPLACED OR DELETED ⚠⚠
The master's old slide 7 ("P&L Statements Pro Forma") is STALE and CONTRADICTORY:
- Uses thousands (34,857,000) not millions.
- Uses FY (not calendar) basis.
- Shows the deal **DILUTIVE** (-14.6%/-12.2%/-7.9%/-6.2%) on a GAAP basis — directly CONTRADICTS slide 6 (non-GAAP) and slide 8 (accretive +8%/+11%).
- Uses stale share counts (1,074M) and a different synergy schedule.
ACTION: This slide must be DELETED (slide 6 is the canonical pro forma) OR fully replaced with a
non-GAAP accretion/dilution slide consistent with slides 6 and 8. Do NOT reproduce this slide as-is
in any generated deck. The deck must contain exactly ONE pro forma view and ONE accretion conclusion.

---

### SLIDE 8 — EXCHANGE RATIO & DEAL CONSIDERATIONS
Two side-by-side tables.

DEAL CONSIDERATIONS (left):
```
Structure              Cash-and-stock acquisition
Consideration mix      60% cash / 40% stock              [ASSUMPTION]
Offer price            $111.80 / share                   [ASSUMPTION: 30% premium]
Premium to current     30%                               [ASSUMPTION]
Total equity value     $29.2B                            [COMPUTED]
Cash portion           $17.5B (debt-financed)            [COMPUTED]
Stock portion          $11.7B                            [COMPUTED]
Financing rate         5% (assumption)                   [ASSUMPTION]
Marginal tax rate      21%                               [ASSUMPTION]
Pro forma ownership    92.5% CRM / 7.5% TEAM             [COMPUTED]
EPS impact (non-GAAP)  8.0% CY2026E / 11.3% CY2027E (accretive)   [COMPUTED]
```
EXCHANGE RATIO (right):
```
Atlassian current price       $86.00     [VERIFIED]
Offer price per share         $111.80    [ASSUMPTION]
Salesforce share price        $166.00    [VERIFIED]
Cash per TEAM share           $67.08     [COMPUTED]
Stock per TEAM share          $44.72     [COMPUTED]
Exchange ratio                0.2694 CRM per TEAM share  [COMPUTED = stock/share ÷ CRM price]
Atlassian shares outstanding  261 M      [VERIFIED]
New Salesforce shares issued  70.3 M     [COMPUTED]
Salesforce shares (pre-deal)  868 M      [VERIFIED post-ASR]
Pro forma total shares        938.3 M    [COMPUTED]
```
RULE: no leading "+" in the EPS cell (caused #ERROR! in master — write "8.0% ... (accretive)" as text).
FOOTNOTE (required): "Share prices per market data ({DATA_DATE}); offer price, premium, mix, financing,
and tax are illustrative transaction assumptions. EPS impact on a non-GAAP basis. Illustrative — not investment advice."

---

### SLIDE 9 — OVERVIEW OF {TARGET} EQUITY PERFORMANCE
Line chart (target closing price, trailing ~12 months) + numbered event annotations (key catalysts).
Reference events (Atlassian, verified from filings/news): Q4 FY25 print & guidance reaction;
M&A (Browser Company $488mm); Q2 FY26 first $1bn cloud quarter & SaaS de-rating; ~1,600-job
restructuring; 52-week low ~$57; Q3 FY26 beat (+32% rev, EPS $1.75 vs $1.34) & ~28–30% surge.
Each event: date — one-line description with the share-price reaction. Chart must mark the events.

---

### SLIDE 10 — PRO FORMA TRADING PROFILE & OWNERSHIP
Trading-profile table (Stock Price, Shares Out, Market Cap, Avg Daily Volume, Avg Daily Value,
Beta, 52-wk High, 52-wk Low) for Acquirer / Target / Combined + ownership pie (acquirer % / target %).
⚠ FIX (STALE DATA): master slide 10 uses pre-correction figures:
  - CRM price $179.02, shares 818M, market cap $146.40B/$169.40B combined — STALE.
  - Verified: CRM ~$166, 868M shares post-ASR, ~$144.1B cap; combined ~$168B.
  - New shares 128M / ownership 86.5%/13.5% — INCONSISTENT with slide 8 (70.3M / 92.5%/7.5%).
  RESOLUTION: ownership split must equal slide 8 (70.3M new shares → 92.5%/7.5%) OR the offer/mix
  must be reconciled so all slides use ONE share-issuance number. The 128M vs 70.3M discrepancy comes
  from different stock-portion assumptions; pick one and propagate everywhere.

---

### SLIDE 11 — RELATIVE CONTRIBUTION
Horizontal stacked bars + table: each financial line split acquirer% vs target%, vs ownership%.
Basis: NON-GAAP. Metrics: Revenue, Gross Profit (NG), Operating Income (NG), Free Cash Flow, then Pro Forma Ownership.
Thesis line: "{Acquirer} acquires 100% of {Target}, which contributes X–Y% of pro forma financials, for Z% of combined equity."
⚠ FIX: master uses Atlassian revenue $5,222M (stale FY25) and ownership 13.5%. Reconcile to verified
CY2025 $5,760M and the slide-8 ownership (7.5%). Contribution % must recompute accordingly.
FOOTNOTE present (good): cites CRM FY26 10-K + Atlassian FY25, non-GAAP basis, ownership per assumptions.

---

### SLIDE 12 — DISTRIBUTION OF STOCK PRICE
Table: reference prices (Current, 52-wk High, 52-wk Low, Mean Analyst Target, Fair Value) vs Our Offer,
with Premium/(Discount). Football-field chart of valuation ranges by methodology.
⚠ FIX: master shows raw ratios "0.3" and "0.983" in the Premium column (rows Current Price and 52-Week
Low) — these are unformatted decimals that should be **+30.0%** and **+98.3%** (or shown as premium %).
Also offer shows $111.05 here but $111.80 on slide 8 — PICK ONE OFFER PRICE deck-wide ($111.80).
Also current price $85.42 here vs $86.00 on slide 8 — reconcile to one verified price.

---

### SLIDE 13 — ANALYST CONSENSUS OVERVIEW
Bar chart of individual broker price targets (target company) + consensus summary box
(total analysts, buy/hold/sell, mean/median/high/low target, current price, our offer).
Reference (Atlassian): 35 analysts, 22 buy / 11 hold / 2 sell, mean $143.18, median $145.63,
high $295 (Bernstein), low $90 (Truist), current $85.42, offer $111.05.
⚠ FIX: offer price $111.05 must reconcile to slide 8's $111.80; current price to $86.00.

---

### SLIDE 14 — VALUATION MATRIX
Football-field chart: implied share-price ranges by methodology (52-wk trading range, analyst targets,
DCF sensitized, sector median EV/Rev, precedent SaaS M&A). Each method shows a low–high bar.
Reference ranges ($/share): 52-wk 56–223; Analyst 90–295; DCF 120–165; Sector EV/Rev(5.5x) 115–130;
Precedent SaaS M&A(6–8x) 133–164.

---

### SLIDE 15 — SOURCES & METHODOLOGY
Full sourcing disclosure. Required sections:
1. PRICING & MARKET DATA — share prices, market cap, ranges, volume, beta; "as of {DATA_DATE}"; named sources.
2. COMPANY FILINGS (PRIMARY) — acquirer 10-K + latest results; target 10-K + latest results; peer filings.
3. ANALYST ESTIMATES & CONSENSUS — forward estimates, price targets, ratings; named brokers.
4. THIRD-PARTY DATA PROVIDERS — fair-value source; employee/customer aggregators.
5. BASIS OF PRESENTATION — $M units; GAAP vs non-GAAP labeled; differing fiscal years labeled; EV definition; buyback approximation note.
6. TRANSACTION ASSUMPTIONS — offer/premium/synergies/ownership/accretion are illustrative; not a real transaction.
7. DISCLAIMER — hypothetical, educational, not investment advice; market data "as of {DATA_DATE}", subject to change.
⚠ FIX: master sources page says "as of June 1, 2026" — update to the actual verified pull date and keep ONE date deck-wide.

---

## 3. MASTER LIST OF DEFECTS TO FIX (do not reproduce these in any generated deck)

| # | Slide | Defect | Correct behavior |
|---|-------|--------|------------------|
| 1 | 1,15  | Date "June 1, 2026" but data is June 12 | One DATA_DATE deck-wide = actual pull date |
| 2 | 2     | EPS-impact row GAAP/dilutive contradicts accretive headline | Recompute non-GAAP (accretive) or relabel basis |
| 3 | 2     | CRM market cap $136.0B (819M sh) vs $144.1B (868M sh) elsewhere | One post-ASR figure ($144.1B) everywhere |
| 4 | 4     | GAAP EPS "4,6,8" rounded | 4.20 / 6.36 / 7.80 (two decimals) |
| 5 | 5     | Op margin cells show "-3." (stray period) | Clean "(3%)" |
| 6 | 7     | Stale, thousands, FY basis, DILUTIVE — contradicts 6 & 8 | DELETE or replace with non-GAAP accretive |
| 7 | 10    | Stale prices/shares ($179.02, 818M, $169.4B); 128M new shares / 86.5%-13.5% | Reconcile to verified + slide-8 ownership (70.3M / 92.5%-7.5%) |
| 8 | 11    | Atlassian rev $5,222M stale; ownership 13.5% | CY2025 $5,760M; ownership 7.5% |
| 9 | 12    | Premium shows raw "0.3"/"0.983"; offer $111.05 | Format as +30.0%/+98.3%; offer $111.80 |
| 10| 13    | Offer $111.05, price $85.42 | Reconcile to $111.80 / $86.00 |
| 11| ALL   | Offer price $111.05 vs $111.80; current $85.42 vs $86.00 | ONE offer, ONE current price deck-wide |

ROOT CAUSE of most defects: slides built at different times from different data snapshots and
mixed GAAP/non-GAAP without a single locked assumption set. The fix is a single
"deal assumptions + verified data" block that ALL slides read from.

---

## 4. IMPLEMENTATION STATUS (EasyM&A generator — maintained by Claude Code)

### Phase 1 — GUARDRAILS (DELIVERED)
- **C1 single source of truth**: `src/lib/deckModel.js` (`buildDeckModel`) — every shared number
  (market cap, EV, offer/current price, ownership %, share counts, exchange ratio, accretion)
  computed ONCE; `DeckShell` builds it via `useMemo` and passes to every section. §9/§10 wired
  (ownership was the genuine duplication). Verified byte-identical (`scripts/diag_c1.mjs`: 17/17).
- **C3 validator**: `scripts/validateDeck.mjs` — renders a deck and asserts cross-slide invariants
  (offer/current price/market cap/ownership consistency, accretion-sign, one DATA_DATE, EPS≥2dp,
  no '=' cells, leading '+' warn, forecast-GAAP-blank, sources footnotes). `--selftest` proves it
  catches all 8 master-defect classes; passes clean on CRM/TEAM and MSFT/ADBE (no SF/TEAM leakage).

### Phase 2a — CONFORMANCE BATCH + EXCHANGE RATIO SLIDE (DELIVERED)
- Defect #1 fully closed: title page now shows the data-pull date (verified asOf), not `new Date()`;
  validator gained a `title-date` check. One DATA_DATE deck-wide (10 mentions agree).
- Basis/sourcing labels: §4/§5 sub-headers carry "(GAAP, $ in millions)"; Sources §15 now prints the
  concrete DATA_DATE, the EV definition, the $M-vs-$B rule, and the GAAP/non-GAAP basis statement.
- Formatting: §4/§5 negative EBITDA/Net Income render in (parentheses); §2 market cap is one-decimal
  $B with no tilde ("$145.1B") — now matches §6/§9 exactly.
- §2 column order: acquirer pinned first, target second (• ACQUIRER / • TARGET), then peers.
- §11 carries the spec thesis sentence ("{Acquirer} acquires 100% of {Target}, which contributes
  X–Y% … for Z% of combined equity").
- §5 standalone commentary moved off deal terms (margin/scale only); deal terms now live on the new slide.
- NEW Slide 8 — Exchange Ratio & Deal Considerations (`SectionExchangeRatio.js`), built entirely from
  the C1 derived object (offer, premium, cash/stock split & per-share, exchange ratio, ownership,
  pre-deal/new/pro-forma shares). Wired into DeckShell at spec position (after Pro Forma, before Equity).
- Validator + qaFull updated to the 17-section order (named index map). Self-test still 8/8; CRM/TEAM
  and MSFT/ADBE both 10 pass / 0 fail.
- Deferred from this batch (with reason): $M-on-all-P&L-lines (bundle with the §4/§5 multi-year rebuild,
  rank 21); §2 title kept as "Comparable Public Companies" (clearer than the spec's screening title for
  a decided target; audit-accepted).

### Phase 2b — NON-GAAP + REMAINING STRUCTURE (PENDING)
Method chosen: EDGAR add-back proxy (TTM) — non-GAAP ≈ GAAP + SBC + intangible amortization +
restructuring (after-tax for net income). Flips GAAP-unprofitable targets (e.g. TEAM −$117M → +$1,014M)
to non-GAAP-profitable, yielding the spec's accretive headline. To build: extend /quote EDGAR extraction
with the add-back tags; recompute accretion on non-GAAP and relabel §7/§6/§11/§2-EPS-impact + basis labels.

Data-availability constraint to resolve first: the free data stack (EDGAR + CNBC/Nasdaq prices +
Nasdaq/StockAnalysis price-target consensus) has **GAAP fundamentals only** and **no forward
non-GAAP EPS / net-income estimates**. The spec's non-GAAP accretive headline (§1.1, defects #2/#6)
and the §6 non-GAAP pro-forma projection therefore need either an assumption-input layer, an EDGAR
SBC/intangible-amortization add-back proxy (+ a forward growth assumption), or per-deal supplied
non-GAAP inputs. Resolve the approach before building the headline/§6 (it changes user-facing numbers).
