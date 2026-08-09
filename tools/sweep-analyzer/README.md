# sweep-analyzer

The 24/24 fuzz-sweep analyzer from Stage 10. Given a captured deck (rendered
`data-section-id` innerText + an independent `/quote` + `/api/price` oracle per
company), it recomputes every derived figure and compares it to what the deck
rendered — printing `inputs · mine · rendered · Δ` for each of 24 checklist
items and emitting structured findings.

It is also a **working prototype of the deferred Pattern-A generic assertion**:
`xs()` (the cross-surface helper) already generalises "a rendered field has a
fresher/more-complete value on another surface" into one reusable check.

## Files
- `analyze.js`   — the analyzer. Deterministic, no network. Reads captures, writes findings + `flags.json`.
- `allowlist.js` — the suppression allowlist (readable ruleset). What the sweep chose NOT to flag, and why.
- `item17.js`    — the ONE live check: `/api/pnl` three-leg LTM (annual + latest interim − prior interim). Needs the app at `:3001`.
- `capture.js`   — the Puppeteer capture harness that produced `docs/sweep-v2/captures/`. Regenerating costs ~164 min + live drift.
- `selftest.js`  — runs the 5 positive controls. `node tools/sweep-analyzer/selftest.js` → exit 0 if the 4 live defects still flag.

## Run
```
# analyze the committed captures (default RAW_DIR = docs/sweep-v2/captures)
node tools/sweep-analyzer/analyze.js                 # all captures
node tools/sweep-analyzer/analyze.js <a.json> <b>…   # specific ones
# env: RAW_DIR, OUT (findings md), FLAGS (json), EXPECTED (allowlist-absorbed json)

node tools/sweep-analyzer/selftest.js                # 4/4 controls, no network
node tools/sweep-analyzer/item17.js                  # live; needs app at :3001 (BASE overridable)
```

## The 24 items
| # | checks |
|---|---|
| 1 | builds? page count · console/page errors (a lone 429 = benign nongaap LLM limiter, GAAP fallback) |
| 1b| data freshness — a company presented as current whose latest actual FY / balance sheet is ≥2y old |
| 2 | bad tokens: NaN · undefined · Infinity · `$NaN/$undef/$null` · `(NaN\|null\|undefined)%` (bare-null / `-0` / `$0` deferred) |
| 3 | net debt (target) = debt − cash − ST securities, vs §2 |
| 4 | current EV (target §2) = price×shares + net debt |
| 5 | equity value = offer × shares, vs §txn (market equity px×shares folded into #4) |
| 6 | EV / revenue (target §2) = EV ÷ LTM revenue |
| 7 | EV / EBITDA (target §2) = EV ÷ LTM EBITDA |
| 8 | P / E (target §2 LTM) = price ÷ LTM EPS |
| 9 | combined revenue = acquirer LTM + target LTM |
| 10| combined EBITDA = A + B + Y1 synergies, vs rendered; also flags the mislabeled "non-positive" caption |
| 11| pro forma NI = acqNI + tgtNI + after-tax synergies + financing (financing renders in parens = already negative) |
| 12| pro forma EPS = PF NI ÷ PF shares (dil + new). GOOGL/AMZN reference = **8.38** |
| 13| accretion % = (PF EPS − standalone) ÷ standalone, vs rendered; suppressed on a non-positive base |
| 14| exchange ratio = offer ÷ acqPx, AND the stock-leg ratio (offer×stock%÷acqPx) |
| 15| sources total = uses total |
| 16| new debt = cash consideration + target debt repaid − excess cash (floored) |
| 17| LTM rev & LTM NI three legs (annual + latest interim − prior interim) — **live**, see `item17.js` |
| 18| revenue · cost of revenue · gross profit · gross margin — cross-surface (§2 vs §6/§7/§8) + combined-margin null-in-sum |
| 19| operating income · net income cross-surface (§7 vs §8). EBITDA leg is informational (§2 carries only the multiple) |
| 20| shares · cash · total debt · net debt · EV · market cap — cross-surface (oracle vs §2 vs §16) |
| 21| total assets · accretion · exchange ratio · premium |
| 22| every "—": field · section · why; flags any "—" that HIDES a figure present elsewhere |
| 23| accretive/dilutive claim off a ≤0 base |
| 24| sector behaviour signals: bank EV/EBITDA suppression · foreign FX · DCF suppression · negative equity (restaurant split + the does-not-fire half deferred) |

## Two things that trip people up
- **`—` and `n/m` are DIFFERENT states.** `—` is missing data; `n/m` is a
  deliberate third state the app added so a negative base doesn't render a
  false accretive/dilutive verdict. `stateOf()` distinguishes them; n/m is
  never counted as missing. Flagging n/m as missing would be a false positive
  against a fix that already shipped.
- **Items 11/12 fall back to the narrative synergy.** Some structures
  (banks/crypto) omit the "After-Tax Synergies (Y1)" tile and render only a
  narrative "Year 1 cost synergies of $X" (PRE-tax). The check falls back to
  that string × 0.79 (after-tax). Without it, the internal PF-NI sum looks
  wrong when it is not — a parse gap, not a defect.

## Provenance / caveats
- Recompute oracle = `/quote` (fundamentals) + `/api/price` (live price) at
  capture time. §2 columns are `acquirer | target | peers…` — take the FIRST
  two value cells, not the last (peers).
- The captures in `docs/sweep-v2/captures/` are a 2026-08-07/08 snapshot; live
  data drifts. A value differing from these is drift, not necessarily a defect.
- Findings, gates, and the ranked list live in `docs/sweep-v2/`.
