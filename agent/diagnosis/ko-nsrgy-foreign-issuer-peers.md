# 5. KO/NSRGY comparables degrade (foreign-issuer gap)

Run `20260929-193005`.

## STEP 0 — repro
`GET /api/peers/NSRGY` → `{"peers":["AAPL","MSFT","AMZN","GOOGL","JPM","JNJ","WMT"],"source":"broad-default","trust":"untrusted"}`

Repro confirmed: `source: broad-default, trust: untrusted`. SectionComparables sets `peersSuppressed` from that result and renders
"No comparable public peers identified — comparables omitted" (`src/components/deck/sections/SectionComparables.js:402-405`).

## Trace
1. `server.js` `/api/peers/:ticker` → `resolvePeers('NSRGY')`
2. Tier 1 `PEER_OVERRIDES['NSRGY']` → absent.
3. `cikBySymbol['NSRGY']` → **undefined**. `loadTickers()` builds that map only from SEC `company_tickers.json`, and Nestlé
   (an OTC ADR with 12g3-2(b) exemption, no 10-K/20-F) is not in it. So `targetSic = null`. This is the oracle's `sic=undefined`.
4. Tier 2 (same-SIC cache) needs `cik && targetSic` → skipped.
5. Tier 3 `sectorPoolForSic(null)` → `null` (`if (!sic) return null`) → skipped.
6. Tier 4 → `BROAD_DEFAULT` mega-caps, `trust: 'untrusted'` → suppressed on the §2 slide and in `/api/sector-multiple`.

Live FMP profile for NSRGY (`/api/profile/NSRGY`): `industry: "Packaged Foods · Consumer Defensive"`. The raw FMP
`industry` field is `Packaged Foods`, which maps to curated `SECTOR_PEERS['2000']` (food: MDLZ, GIS, K, HSY, KHC, CPB), an exact pool.

## Root cause
Peer resolution reads the industry only from the EDGAR SIC, and a foreign issuer with no SEC CIK never gets a SIC. So every
foreign target skips the tiers keyed on industry and lands on the untrusted broad default. Pattern **New**: a gate built for
domestic filers with no path for foreign issuers. It is not a stale value, a null coerced to zero, or an accidental guard.

## Fix (`server.js`)
- `FMP_INDUSTRY_TO_SIC` (next to `SECTOR_PEERS`): maps FMP industry → SIC. It lists only industries whose SIC has an
  **exact** `SECTOR_PEERS` pool.
- `fmpIndustryFor(ticker)`: raw FMP `/stable/profile` `industry`, cached per ticker (a failed fetch is not cached).
- `resolvePeers`, new tier 2b: this runs **only when there is no CIK**. The mapped SIC feeds the same `sectorPoolForSic`
  tier 3 (no parallel pool). The response carries `sicBasis: 'fmp-industry'` for provenance. An unmapped industry stays null
  and still goes to broad default (suppressed), so nothing is guessed.
- A domestic filer with a CIK takes the same path as before. `sicBasis: 'edgar'` is added to sector-default responses, and
  `/api/peers` passes it through. The slide ignores that field.

Expected after the runner restarts the server: `/api/peers/NSRGY` → `peers [MDLZ, GIS, K, HSY, KHC, CPB]`, `source sector-default`,
`trust trusted`, `sicBasis fmp-industry`. The comps slide then shows real packaged-food peers instead of the suppression banner.
Not measured here: per the harness rules, no server restart was done.

## Not addressed
- The "CNBC" source on the NSRGY column's own data: Nestlé has no EDGAR filings, so its own figures can never come from EDGAR.
  The item accepts the "explicit foreign-issuer handling" alternative, and that is the branch implemented.
- The `/api/sector-multiple` sector median for NSRGY now uses the trusted pool-2000 median. Before, it was suppressed. This
  change is intended and follows from the trust change.
- The source label reads "Peers selected by sector (approximated)" (the existing `sector-default` label). The src label is
  unchanged, so no `npm run build` dependency is added.
