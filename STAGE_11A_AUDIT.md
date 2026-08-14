# STAGE 11-A — Market-Data Dependency Audit (READ-ONLY)

Repo: `ma-app` · React :3000 / Express server.js :3001 · plain JS/CommonJS.
Baseline: `STAGE_11A_BASELINE.json` (2026-08-09T23:10Z, 6/6 pairs, 17 sections each).
No source file modified. Evidence is `file:line`, verbatim, from reading bodies.

**Enumeration (VERIFY #1):** `find src -type f -name "*.js" | wc -l` → **55** (+1 `.jsx` = 56).
All 55 were grepped for the field/coercion patterns below; the market-data-relevant bodies
(App.js, server.js, dealCalc.js, netDebt.js, deckRegistry.js, and 8 Section*.js files) were
opened and read in full. Files with zero market-data grep hits were searched, not opened.

Three schemas exist and drift (see Task 6): the **/quote data object** (`revenue`,`shares`,
`eps`,`sharePrice`), the **inputs object** (`companyARevenue`,`companyAShares`,`companyAEPS`,
`currentSharePriceA`), and the deck **`deal`/company** objects.

---

## Task 2 — Market-data field inventory (reads; behavior when null)

| File | Line | Verbatim expression | What it feeds | Behavior if field is null |
|---|---|---|---|---|
| src/utils/dealCalc.js | 26 | `const live = parseFloat(inputs.currentSharePriceA) \|\| 0;` | acquirer share price for stock issuance | **→ 0** (Pattern B). Then acquirerSharePrice falls to `eps>0 ? eps*15 : 0` (28-29) |
| src/utils/dealCalc.js | 67 | `return parseFloat(inputs.currentSharePriceB) \|\| 0;` | targetMarketPrice → premium basis | **→ 0** → premium computed `tgtPrice>0 ? … : null` (174) so premium becomes null, not wrong |
| src/utils/dealCalc.js | 28 | `const eps = parseFloat(inputs.companyAEPS) \|\| 0;` | acquirer price proxy (eps×15) | **→ 0** → proxy 0 |
| src/utils/dealCalc.js | 37-38 | `const reported = parseFloat(inputs.companyAEPS); if (…reported !== 0) return reported;` | standalone EPS baseline (accretion) | null → falls to `ni/shares` (39-41) |
| src/utils/dealCalc.js | 40 | `parseFloat(inputs.companyADilutedShares) \|\| parseFloat(inputs.companyAShares) \|\| 0;` | acquirer diluted share base | **→ 0** → `shares>0 ? ni/shares : 0` (41) |
| src/utils/dealCalc.js | 85 | `const shares = num(inputs.companyBShares) \|\| 0;` | target shares → cash consideration | **→ 0** (Pattern B) → cashConsideration 0 |
| src/utils/dealCalc.js | 124 | `const totalPurchasePrice = offerPricePerShare * companyBShares;` | purchase price, EV, cash/stock | null×n = **NaN** propagates unless guarded upstream |
| src/utils/dealCalc.js | 131 | `const newSharesIssued = acqPrice > 0 ? stockPortion / acqPrice : 0;` | dilution, PF shares | acqPrice 0 → **0 new shares** |
| src/utils/dealCalc.js | 180 | `(companyBDebt != null && companyBCash != null) ? totalPurchasePrice + companyBDebt - companyBCash : null` | enterprise value | null debt/cash → **EV null → 'N/A'** (correct guard) |
| src/App.js | 538 | `currentSharePriceA: data.sharePrice \|\| prev.currentSharePriceA \|\| 0` | inputs.currentSharePriceA | **→ 0** if all absent (Pattern B); comment 536 acknowledges EDGAR returns no price |
| src/App.js | 578 | `currentSharePriceB: data.sharePrice \|\| prev.currentSharePriceB \|\| 0` | inputs.currentSharePriceB | **→ 0** if all absent |
| src/App.js | 743 | `sharePrice: inputs.currentSharePriceB > 0 ? inputs.currentSharePriceB : null` | target `deal` sharePrice | guarded → null (not 0) |
| src/App.js | 745 | `currentMarketCap: inputs.currentSharePriceB > 0 ? …*companyBShares : null` | target market cap | guarded → null |
| src/App.js | 749 | `tpp>0 ? tpp : (currentSharePriceB>0 ? currentSharePriceB : companyBEPS*15)*companyBShares` | fallback target value | **EPS×15 proxy** when no price (Pattern A/C surface) |
| src/App.js | 781 | `marketCap: (currentSharePriceA>0 ? currentSharePriceA : companyAEPS*15)*companyAShares` | acquirer market cap | **EPS×15 proxy** when no price — unconditional (no null branch) |
| src/utils/dealCalc.js | 314 | `` `$${(parseFloat(inputs.offerPricePerShare) \|\| 0).toFixed(2)}` `` | narrative offer string | **→ $0.00** if null |
| src/components/deck/sections/SectionComparables.js | 313 | `const tgtPx = parseFloat(baseInputs.currentSharePriceB) \|\| 0;` | per-peer EPS-impact recompute | **→ 0** (Pattern B) |
| src/components/deck/sections/SectionProFormaPL.js | 162 | `const offer = parseFloat(deal?.offerPrice) \|\| parseFloat(inputs.offerPricePerShare) \|\| 0;` | PF EPS forward bridge | **→ 0** |
| src/components/deck/sections/SectionProFormaPL.js | 164 | `const tgtDilSh = parseFloat(inputs.companyBDilutedShares) \|\| parseFloat(inputs.companyBShares) \|\| 0;` | PF diluted shares | **→ 0** |
| src/components/deck/sections/SectionAnalystConsensus.js | 123-124 | `const sharePrice = parseFloat(target?.sharePrice); const currentPrice = isNaN(sharePrice) ? null : sharePrice;` | consensus chart "Current" marker | null-safe → **null** (marker omitted, 147) |
| src/components/deck/sections/SectionExchangeRatio.js | 135-136 | `dash(d.currentPriceTarget, fmtPerShare)` / `dash(d.currentPriceAcquirer, fmtPerShare)` | deal-terms table | null → **"—"** (dash guard, 76) |
| server.js | 787,789 | `const netIncome = income?.netIncome \|\| 0;` `const eps = income?.eps \|\| 0;` | /quote FMP company summary | **→ 0** (Pattern B) feeding companyBNetIncome/EPS |
| server.js | 864,866 | `const netIncome = ish.netIncome?.raw \|\| 0;` `const eps = ks.trailingEps?.raw \|\| 0;` | /quote Yahoo fallback summary | **→ 0** (Pattern B) |
| server.js | 831,884 | `eps: parseFloat(((eps \|\| 0) * fx.avgRate).toFixed(2))` / `eps: parseFloat((eps \|\| 0).toFixed(2))` | /quote returned `eps` | **→ 0** |

Fields with **no read found** in src/ or server.js: `stockPrice`, `basicShares`, `dilutedEPS`
(as a distinct key; EPS is `eps`), `epsNTM` (forward EPS is a column field `eps` on estimate
rows, not a top-level `epsNTM`), `analystTarget` (the key is `priceTarget`, server.js:1451),
`week52High`/`week52Low` (rendered from a `priceHistory`/`prices` series in
SectionPricePerformance/SectionEquity, not top-level `week52*`). `marketCap` is READ only in
`src/lib/explanations.js:257` (`const mc = parseFloat(marketCap) || 0;`) and constructed in
App.js:745/781; not a fetched field.

---

## Task 3 — Zero-coercion trap hunt (Pattern B)

**Search commands run (all executed; counts + one verbatim match each):**
```
grep -rnE "\|\| ?0\b" src/ server.js            → 189 hits; e.g. dealCalc.js:26  const live = parseFloat(inputs.currentSharePriceA) || 0;
grep -rnE "\?\? ?0\b" src/ server.js            → 18 hits;  e.g. App.js:1147     … (suggestedPrice ?? 0);
grep -rn  "parseFloat(" src/ server.js          → 247 hits; e.g. dealCalc.js:26  parseFloat(inputs.currentSharePriceA)
grep -rn  "Number("     src/ server.js          → 24 hits;  e.g. App.js:118      Number(v).toLocaleString('en-US')
grep -rnE "(parseFloat|Number)\([^)]*(currentSharePrice|company[AB]Shares|company[AB]EPS|sharePrice|livePrice|marketCap|offerPrice)" src/ server.js  (market-data intersect)
```

**Market-data fields that can become 0 instead of staying absent (Pattern B surface):**

| File:Line | Verbatim | Field that reaches it |
|---|---|---|
| src/utils/dealCalc.js:26 | `parseFloat(inputs.currentSharePriceA) \|\| 0` | acquirer share price |
| src/utils/dealCalc.js:28 | `parseFloat(inputs.companyAEPS) \|\| 0` | acquirer EPS |
| src/utils/dealCalc.js:40 | `parseFloat(inputs.companyADilutedShares) \|\| parseFloat(inputs.companyAShares) \|\| 0` | acquirer shares |
| src/utils/dealCalc.js:58 | `const cover = parseFloat(inputs.companyAShares) \|\| 0;` | acquirer cover shares |
| src/utils/dealCalc.js:67 | `parseFloat(inputs.currentSharePriceB) \|\| 0` | target share price |
| src/utils/dealCalc.js:85 | `num(inputs.companyBShares) \|\| 0` | target shares |
| src/App.js:538 / :578 | `data.sharePrice \|\| prev.currentSharePrice[AB] \|\| 0` | live share price |
| src/components/deck/sections/SectionComparables.js:313 | `parseFloat(baseInputs.currentSharePriceB) \|\| 0` | target price (peer recompute) |
| src/components/deck/sections/SectionProFormaPL.js:164 | `parseFloat(inputs.companyBDilutedShares) \|\| … \|\| 0` | target diluted shares |
| server.js:787 / :789 | `income?.netIncome \|\| 0` / `income?.eps \|\| 0` | FMP summary NI / EPS |
| server.js:864 / :866 | `ish.netIncome?.raw \|\| 0` / `ks.trailingEps?.raw \|\| 0` | Yahoo summary NI / EPS |
| server.js:831 / :884 | `eps: parseFloat((eps \|\| 0) …)` | /quote returned EPS |
| src/lib/explanations.js:257 | `const mc = parseFloat(marketCap) \|\| 0;` | market cap (explain tooltip) |
| src/components/deck/shared/deckTokens.js:393 | `parseFloat(results?.newSharesIssued \|\| 0) / inputs.companyAShares` | dilution flag |

**PATTERN B · HIGHEST RISK** — `dealCalc.js:67` (`currentSharePriceB || 0`) followed by
`dealCalc.js:174` `purchasePremium = tgtPrice > 0 ? … : null`: here the 0-coercion is
neutralised by a `> 0` guard (premium → null, not a wrong number). But `dealCalc.js:26`
(`currentSharePriceA || 0`) has NO downstream `>0` guard on the market-cap path
(`App.js:781` multiplies unconditionally through the EPS×15 proxy) — a private acquirer with
no price yields `companyAEPS*15*companyAShares`, a **plausible fabricated market cap**, not "—".

### Task 3b — the three baseline $0 sites, traced to source

Render layer is **uncoerced** (SectionStandalonePL.js:77,80): `fmtM=(v)=>v==null?'—':…`,
`fmtEpsV=(v)=>v==null?'—':…`; columns read `get: c => c.netIncome` (92) / `c.eps` (95) with
**no `|| 0`**. Column-build layer is also uncoerced — server.js /api/pnl:
- actual columns: `netIncome: netInc` (null if absent), `eps: sEps[end] != null ? sEps[end] : null`
- forward columns: `netIncome: e.netIncomeAvg != null ? inM(e.netIncomeAvg) : null`, `eps: e.epsAvg != null ? e.epsAvg : null`

So a **null at source renders "—"**; a rendered `$0`/`$0.00` means the source value is genuinely 0.

| # | Site | Upstream field | Source value (uncoerced path) | Verdict |
|---|---|---|---|---|
| 1 | MCD/RRGB §F Net Income `$0`, Diluted EPS `$0.00` (forward FY) | `pnl.columns[fwd].netIncome` / `.eps` ← FMP `e.netIncomeAvg`/`e.epsAvg` | The forward series is **populated with distinct real values** in the same row: NI `($6) $2 $0`, EPS `($0.32) $0.11 $0.00`. Uniform null-coercion would show all `$0`; the −6→2→0 / −0.32→0.11→0.00 progression proves FMP returned a real declining-to-breakeven series whose tail is ~0. | **REAL ZERO** (FMP estimate ≈ 0; a null would render "—") |
| 2 | MCD/RRGB §G proforma `$0` line | proforma cell (SectionProFormaPL) | Isolated `$0` on a tiny deal (synergy/financing line). Same `v==null?'—'` render family; a null renders "—". | **REAL ZERO** (a real 0 line item; null → "—") |
| 3 | RKLB/IRDM §E Non-operating income `$0` (actual FY), Diluted EPS `($0.00)` | `pnl.columns[actual].nonOperatingIncome` / forward `.eps` | Actual-column `$0` = `sNoi[end]` returned 0; adjacent actuals `($1) $0 $3 $14` show the row is real. EPS `($0.00)` = a real near-zero negative estimate (fmtEpsV renders `-0.00x` for small negatives). | **REAL ZERO** (near-zero) |

No site left UNRESOLVED. (Note: this proves the *app does not coerce* these to 0; it faithfully
renders FMP/EDGAR's value. Whether FMP's own upstream is 0-vs-null was not fetched — forbidden
this phase — but the app path is uncoerced, and the adjacent non-zero series is direct evidence
the source is a real 0, not a null.)

---

## Task 4 — Deck section dependency map (17 sections)

Section→component from `deckRegistry.js` (DECK_ORDER) + `DeckShell` attaches components.
"Renders if absent?" = read from the guard. **All 17 covered.**

| # | Section id | Exhibit | Component | Market-data fields read | Renders if absent? |
|---|---|---|---|---|---|
| 1 | title | Title (unlabeled) | SectionTitlePage.js | `offerPrice` (1 read, cover subtitle) | Yes — cover renders regardless |
| 2 | comparables | Exhibit A | SectionComparables.js | `currentSharePriceB`:313, `offerPrice`:312, `company[AB]Shares/EPS`:321; mktCap sanity gate :56 | **Yes, degraded** — equity/EV/EV-Rev render **"⚠"** when `mktCapSane` false (56); peer EPS-impact uses `tgtPx||0`:313 |
| 3 | profiles | Exhibit B | SectionCompanyProfiles.js | 4 reads (sharePrice, marketCap for header stats) | Yes — profile prose renders; missing stats blank |
| 4 | targetprofile | Exhibit C | SectionTargetOverview.js | curated metrics; minimal price reads | Yes |
| 5 | shareholders | Exhibit D | SectionShareholderAnalysis.js | shares/ownership; `sharesOutstanding` | Yes — ownership table from shares; price-independent |
| 6 | plAcquirer | Exhibit E | SectionStandalonePL.js | `c.eps`, `c.dilutedShares` (17 reads) | **Yes** — `v==null?'—'` (77-81); missing → "—", never NaN |
| 7 | plTarget | Exhibit F | SectionStandalonePL.js | same | **Yes** — "—" for null cells (baseline $0 = real 0, Task 3b) |
| 8 | proforma | Exhibit G | SectionProFormaPL.js | `offerPrice`:162, `companyBDilutedShares`:164, `companyAEPS`:158 (19 reads) | **Yes, degraded** — `offer/tgtDilSh = … || 0`:162,164 → PF EPS bridge can compute off 0 |
| 9 | txnstructure | Exhibit H | SectionTransactionStructure.js | `combinedEBITDA`:92, leverage :94 (1 direct price read) | Yes — leverage `combinedEBITDA>0 ? … : (bankDeal?'n/m':'—')` :94 |
| 10 | exchange | Exhibit I | SectionExchangeRatio.js | `currentPriceTarget/Acquirer`, `targetShares`, `offer` (10 reads) | **Yes** — every cell wrapped in `dash(x,f)=(x==null\|\|NaN?'—':f(x))` :76 → "—" |
| 11 | exchangeratio | Exhibit J | SectionExchangeRatioAnalysis.js | implied ratio = target÷acquirer price (5 reads) | Chart needs both prices; degrades to "—"/empty if absent |
| 12 | equity | Exhibit K | SectionPricePerformance.js | `priceHistory`/`prices` series (2 reads) | **Yes, with proxy** — "Illustrative — modeled from EPS proxy. Real price data unavailable." :398 (Pattern C surface) |
| 13 | contribution | Exhibit L | SectionRelativeContribution.js | revenue/EBITDA/NI (financials, not price) | Yes — contribution % from financials |
| 14 | analyst | Exhibit M | SectionAnalystConsensus.js | `sharePrice`:123, `offerPrice`:125, `priceTarget`/`consensus` (54 reads) | **Yes** — `currentPrice = isNaN(sharePrice)?null:…`:124; null marker omitted :147; targets `.filter(v=>v!=null&&!isNaN(v))` :223 |
| 15 | sources | Appendix I | SectionSources.js | attributions (12 reads, mostly labels) | Yes — programmatic attributions |
| 16 | verification | Appendix II | SectionDataVerification.js | every source figure incl. price/shares (25 reads) | Yes — reconciliation table; missing → "?"/"—" state |
| 17 | verification2 | Appendix III | SectionDataVerification.js | same (cont.) | Yes |

(`dashboard`/Deal Summary is `showInPdf:false`, registry:12 — the 18th DECK_ORDER entry, not a
PDF exhibit; SectionDashboard.js has 22 market-data reads and is the interactive view.)

---

## Task 5 — Exhibit registry behavior

**Labels are COMPUTED from the ordered render list, not static.** `src/components/deck/deckRegistry.js`:

```js
34 // Walk the PDF sections in order: assign exhibit letters, appendix romans, and 1-based page numbers.
37 (() => {
38   let ex = 0, ap = 0, pg = 0;
39   for (const s of DECK_ORDER) {
40     if (!s.showInPdf) continue;
41     PAGE_MAP[s.id] = ++pg;
42     if (s.kind === 'exhibit') LABEL_MAP[s.id] = `Exhibit ${String.fromCharCode(65 + ex++)}`;
43     else if (s.kind === 'appendix') LABEL_MAP[s.id] = `Appendix ${ROMAN[ap++]}`;
44     // 'title' → no exhibit/appendix label
45   }
46 })();
50 export const exhibitLabelOf = (id) => LABEL_MAP[id] || null;
```

- **Static or computed?** Computed. The letter is `String.fromCharCode(65 + ex++)` where `ex`
  increments **only for `showInPdf` sections of `kind:'exhibit'`, in `DECK_ORDER` order** (42).
- **Drop a section → renumber or gap?** **Renumber, no gap.** A dropped section (removed from
  `DECK_ORDER`, or flipped to `showInPdf:false`, 40) simply does not increment `ex`/`ap`/`pg`,
  so the remaining sections re-letter contiguously (A, B, C …) and re-page. The module header
  (lines 2-4) states this is intentional: "inserting / reordering / removing a section updates
  every label and every prose cross-ref automatically."
- **Where:** `deckRegistry.js:37-46` (the IIFE) building `LABEL_MAP`/`PAGE_MAP`; consumed via
  `exhibitLabelOf` (50) and `pageNumOf` (54).

**Implication for private mode:** suppressing market-data sections leaves **no lettering holes** —
labels re-flow. But prose cross-refs ("see Exhibit J") auto-retarget, so a suppressed section that
another section references by letter will point at whatever now occupies that letter unless the
cross-ref is also conditional.

---

## Task 6 — Company object entry points & key drift

**Entry point A — /quote FMP builder** (server.js ~823-843). Keys produced (verbatim):
`companyType, name, revenue, ebitda, netIncome, grossProfit, operatingIncome, shares,
dilutedShares, eps, cash, shortTermInvestments, debt, totalAssets, sharePrice, dataSource,
balanceSheetAsOf, balanceSheetBasis, sic, sicDescription, fiscalYear, fiscalYearEnd,
fiscalPeriod, filingForm, ltm, reportedCurrency, priceCurrency, fxSpotRate, fxAvgRate,
fxAvgWindow, fxConverted` (+ `eps` coerced `|| 0` at 831).

**Entry point B — /quote Yahoo/fallback builder** (server.js ~872-889). Keys produced (verbatim):
`companyType, name, revenue, ebitda, netIncome, shares, eps, cash, debt, sharePrice, dataSource`
(`eps` coerced `|| 0` at 884).

**Entry point C — inputs / manual entry** (src/App.js:431-438 defaultInputs, mapped 527-538).
Keys (verbatim): `companyARevenue, companyAEBITDA, companyANetIncome, companyAOperatingIncome,
companyAGrossProfit, companyAShares, companyADilutedShares, companyAEPS, companyACash,
companyASti, companyADebt, companyABsAsOf, companyABsBasis, companyALtmRevenue,
currentSharePriceA` (mirror for B). Manual entry mutates the SAME inputs keys via
`handleChange` (App.js:506); no separate object.

**Entry point D — non-GAAP overlay** (src/App.js:82-84): `companyANetIncome, companyAEPS,
companyADilutedShares` (overwrites 3 inputs keys from `ngA.nonGaap`).

**Test fixtures / hardcoded samples:** `grep -rlnE "companyARevenue|sampleDeal|fixture|mockCompany"
src/ | grep -iE "test|fixture|sample|mock"` → **none** (no committed company-object fixtures;
only `src/lib/__tests__/composeSourceLine.test.js` exists, unrelated to company objects).

**KEY-DRIFT diff (A vs B — the two /quote builders):**

| Key | FMP builder (A) | Yahoo builder (B) |
|---|---|---|
| grossProfit | ✅ | ❌ absent |
| operatingIncome | ✅ | ❌ absent |
| dilutedShares | ✅ | ❌ absent |
| shortTermInvestments | ✅ | ❌ absent |
| totalAssets | ✅ | ❌ absent |
| ltm | ✅ | ❌ absent |
| balanceSheetAsOf / sic / fiscal* | ✅ | ❌ absent |
| reportedCurrency / fx* | ✅ | ❌ absent |
| revenue / ebitda / netIncome / shares / eps / cash / debt / sharePrice | ✅ | ✅ |

A Yahoo-sourced company (no CIK, e.g. NSRGY per server.js:982) reaches the deck missing
`grossProfit`, `operatingIncome`, `dilutedShares`, `shortTermInvestments`, `ltm`, and FX — the
`?? null` mappings in App.js (529-534) turn the absent keys into null inputs, so downstream those
render "—" (not a crash), but the drift is real and is why a schema contract is phase 0.

---

## Task 7 — Analyzer input contract

**`src/utils/dealCalc.js:113` `export function calculate(inputs)`** — single object, no positional
company args (companies are flattened into `companyA*`/`companyB*` inputs upstream in App.js).

Fields read off `inputs` (destructured 114-121 + read in body):
`companyADebt, companyBShares, companyBEPS, companyBCash, companyBDebt, companyARevenue,
companyAEBITDA, companyANetIncome, companyBRevenue, companyBEBITDA, companyBNetIncome,
offerPricePerShare, cashPercent, transactionFees, synergiesY1/Y2/Y3` (destructured);
plus `currentSharePriceA/B, companyAEPS, companyADilutedShares/companyAShares, companyBDilutedShares,
companyASti, companyBSti, companyALtmRevenue, companyBLtmRevenue, minCashPct, bankDeal,
applySourcesOfFunds` (read via helpers acquirerSharePrice/acquirerDilutedShares/acquisitionNewDebt).

**Required vs optional (from guards/defaults, not naming):**
- **Required (NaN/0 if absent):** `companyBShares` (124 `offer*companyBShares` → NaN),
  `offerPricePerShare` (124), `cashPercent` (123,125).
- **Optional, guarded to null (correct):** `companyBDebt`/`companyBCash` → EV null (180);
  `companyAEBITDA`/`companyBEBITDA` → combinedEBITDA null (144); `companyANetIncome`/
  `companyBNetIncome` → PF NI null (157).
- **Optional, coerced to 0 (Pattern B):** `currentSharePriceA` (26), `currentSharePriceB` (67),
  `companyAEPS` (28), `companyAShares`/`companyADilutedShares` (40,58), `companyBShares` (85).
- **Optional, proxy-substituted:** no live price → acquirer price = `eps*15` (29) / market cap
  `eps*15*shares` (App.js:781) — a fabricated value, not absent.

---

## Task 8 — KO/NSRGY loadA timeout — HYPOTHESIS (not confirmed)

- **Where the timeout lives:** in the **capture harness**, not the app. `/tmp/stage11a_capture.js:16`
  `page.waitForFunction(… /\ loaded/g …, { timeout: 150000 }, idx+1)` (Stage 10 used 80000). It waits
  for the app to render "…loaded" text, i.e. for `fetchCompanyData` (/quote) + `fetchLivePrice`
  (/api/price) + `fetchNonGaap` to settle (App.js:522-557 handleSelectA).
- **Upstream retry/backoff:** none exponential. `/api/price` uses a **multi-source fallback chain**
  server.js:1070-1072 `finnhub → cnbc → yahoo`, each tried once, results pushed to `attempts[]`
  (1077-1092). `/quote` itself parses EDGAR companyfacts with no retry. Cache is 5-min TTL
  (server.js:69) — successes only (75), so a failed heavy fetch retries live every time.
- **What distinguishes the Stage-10 heavy tickers (T, CMCSA, NEE, V, WBD, KO, UNH, ET, HD, RDDT,
  ARM):** they are long-history large-caps → **large EDGAR companyfacts JSON** to fetch+parse in
  /quote. This matches Stage-10 hypothesis (i). Not measured here (a companyfacts fetch is
  forbidden this phase).
- **Rate-limit vs other failure distinguishable?** In the app, `/api/price` records per-source
  `{source, ok, error}` (1084,1092) — distinguishable there. But in the **harness**, a slow /quote
  and a 429 both manifest identically: the "…loaded" text never appears → one branch, the 150s/80s
  `waitForFunction` timeout ("Waiting failed: Nms exceeded"). They **collapse into one error branch**.

**Verdict: HYPOTHESIS.** The code supports "heavy companyfacts + no backoff + single-source /quote"
as the cause and shows rate-limit is indistinguishable from slow-fetch at the harness boundary. One
successful serial 150s build (Task 1) is consistent with a latency/size cause but does **not**
confirm which of {companyfacts size, FMP double-render, serial fetches, O(tags) scan} dominates —
that needs instrumented timings against a live server, deferred.

---

## Named traps found

- **Pattern B (null → 0):** dealCalc.js:26,28,40,58,67,85; App.js:538,578; server.js:787,789,864,866,
  831,884; SectionComparables.js:313; SectionProFormaPL.js:162,164; explanations.js:257. Highest
  blast radius: `currentSharePriceA||0` (26) → market cap via `eps*15*shares` (App.js:781), a
  plausible fabricated number with no null branch.
- **Pattern A (stale-but-present blocks a fallback):** App.js:538/578 `data.sharePrice || prev.currentSharePrice || 0`
  — a **prior** pair's price (`prev.*`) can satisfy the `||` and block the live/EPS-proxy path;
  a stale-but-present price is preferred over recomputation.
- **Pattern C (safety by accident):** SectionPricePerformance.js:398 renders an EPS-proxy chart
  labeled "Real price data unavailable" — it appears to guard missing price, but the guard is the
  *presence of EPS*; a company with neither price nor EPS is not covered by that branch. Also
  SectionStandalonePL "—" safety holds only because the column-build layer (server.js /api/pnl)
  keeps null (uncoerced) — an upstream `|| 0` there would silently break it.

---

## Recommended fixes (DO NOT APPLY — findings only)

1. Replace market-data `|| 0` coercions (dealCalc.js:26,28,40,58,67,85; server.js:787,789,864,866,
   831,884) with null-preserving reads + explicit `> 0` guards, so absent price/shares/EPS render
   "—" not 0/proxy. Private mode depends on this.
2. Remove the unconditional EPS×15 market-cap proxy (App.js:781) — give it the null branch
   App.js:745/749 already has for the target.
3. Unify the two /quote builders (A/B) to one key set (Task 6 drift) — the schema contract.
4. Make prose cross-refs to a section conditional on that section's presence before suppressing
   market-data sections (Task 5 auto-retarget).
5. Instrument the /quote companyfacts fetch/parse to confirm or refute the Task 8 hypothesis
   before changing the harness timeout.

---

## Post-fix findings (appended Stage 11-B; do not restructure above)

### Live defect — manual-entry decks fabricated the acquirer market cap
The manual entry form exposes **no acquirer share-price input** (`src/App.js:1293` defines
`currentSharePriceB` only — the target). `currentSharePriceA` therefore defaulted to **0** on
every manual-entry build, so `App.js:781`'s pre-fix expression
`(currentSharePriceA > 0 ? currentSharePriceA : companyAEPS * 15) * companyAShares` took the
`companyAEPS * 15` branch on **every manual-entry deck**, rendering a fabricated acquirer market
cap (EPS × 15 × shares). This was a **live defect on the public deployment**, not a
private-mode-only concern. Scope: **all manual-entry decks**. Ticker-path decks were unaffected
(a real live price was present, so the true branch was taken). Fixed in Stage 11-B (App.js:781 →
null branch); Phase-4 positive control confirmed the acquirer market cap now renders "—" (the
old `$150,000M` fabrication for EPS 10 × 15 × 1000 sh is gone; 0 console/page errors).

### Recommendation on the missing acquirer share-price input (recommendation only — no form change)
**An acquirer share-price input SHOULD exist in the manual form**, symmetric with the target's
`currentSharePriceB` (App.js:1293). Rationale: the acquirer price drives more than market cap —
it sets share issuance / the stock-leg exchange ratio (`newSharesIssued = stockConsideration ÷
acquirerPrice`). With no acquirer price, the still-live proxies at `App.js:851`, `App.js:1310`,
and `dealCalc.js:29` substitute `companyAEPS * 15` for the acquirer **price**, so a manual
stock-consideration deal issues shares off a fabricated price. So the two options are:
(a) add the acquirer price input (preferred — lets manual users model stock deals correctly), or
(b) keep it absent, in which case the market cap correctly reads "—" (post-fix) but the
    share-issuance proxies (851/1310/dealCalc:29) must ALSO go null/"—" for consistency — the
    deferred proxy-cleanup phase. Leaving (b) half-done (market cap "—" but issuance still on
    EPS×15) is internally inconsistent. Do not change form code here.

### Deferred (Stage 11-C Phase 6c) — SectionTransactionStructure.js:108 transactionEV re-derivation
SectionTransactionStructure.js:108 re-derives transactionEV locally
(equityPurchase + netCashDebt(bDebt, bCash, bSti)) when deckModel returns null. Same bug
class as the §L ownership re-derivation fixed in 11-C: a section overriding the model's
deliberate null. Does NOT coerce to 0, so it fabricates no zero — but it may produce a
period-mismatched EV by bypassing the Fix A period-match guard, which would be Pattern A
(stale-but-present), not Pattern B. Needs its own consumer trace and period-basis check.
Not in the acquirer issuance chain. Deferred.
