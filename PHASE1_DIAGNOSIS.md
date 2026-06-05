# Phase 1 Reactivity Diagnosis

## Root cause: two compounding bugs make it appear inputs don't change outputs

### Bug 1 — EDGAR shares fallback missing (primary)

`fetchFromEDGAR` in `server.js` (line 261–264) resolves shares via:
```
CommonStockSharesOutstanding (us-gaap, 10-K/20-F) ??
EntityCommonStockSharesOutstanding (dei, 10-K/20-F) ??
0
```

For Atlassian (TEAM, CIK 0001650372), both tags have **zero** annual 10-K/20-F entries.
`WeightedAverageNumberOfSharesOutstandingBasic` (us-gaap) HAS the data: 9 entries, most recent
FY2025 10-K (filed 2025-08-15), val = 261,787,000 shares. Not in the fallback chain → shares = 0.

With shares = 0:
- `totalPurchasePrice = offerPrice × 0 = 0` (changing offer price does nothing)
- `newSharesIssued = 0`
- `proFormaEPS` doesn't respond to offer price
- Suggested offer price falls back to revenue method (~$39.8/sh) because shares = 0 prevents
  all EV/EBITDA and revenue-per-share calculations too

**Fix**: add `WeightedAverageNumberOfSharesOutstandingBasic` (and diluted variant) to the
fallback chain in `fetchFromEDGAR`.

### Bug 2 — No free live price source wired (secondary)

The `/api/price/:ticker` waterfall tries FMP → Finnhub → AlphaVantage. FMP returns 403. Finnhub
requires `FINNHUB_KEY` env var (not set). AlphaVantage requires `ALPHAVANTAGE_KEY` (not set).
Yahoo v8/chart endpoint works without auth and returns `regularMarketPrice` but is not in the
waterfall. Result: `currentSharePriceB = 0` → suggested offer falls back to fundamentals.

With negative EBITDA and EPS (TEAM), the only fallback is revenue-based: (revenue × 2) / shares.
Since shares = 0 from Bug 1, this returns null → suggested offer = null → the UI cannot even
prefill an offer price suggestion.

**Fix**: Add Yahoo v8/chart to the price waterfall (first or second position). Move Finnhub to
first so it works when the key IS set.

## The React/prop flow is correct

- `buildTargetForDeck()` / `buildDealForDeck()` are plain object literals computed at render time.
  Every render that changes `inputs` or `results` flows correct new values into DeckShell props.
- No stale closure, no `useMemo`/`useCallback` with wrong deps found in the App→DeckShell path.
- The uncontrolled-input pattern (defaultValue + useEffect sync) fires correctly.
- PDF export captures live rendered DOM; no async race between `setExporting` and `html2canvas`.

## Fix sequence
1. `fetchFromEDGAR`: add `WeightedAverageNumberOfSharesOutstandingBasic` fallback → shares ≈ 262M
2. `/api/price/:ticker`: add Yahoo v8/chart, reorder waterfall → live price ≈ $115–$120
3. After both: Phase 1.3 acceptance tests pass naturally (inputs visibly change all outputs).
