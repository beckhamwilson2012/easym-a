# STAGE 11-B — Phase 5: Exhibit cross-ref inventory (READ-ONLY)

Purpose: `deckRegistry.js:38-44` computes exhibit letters from the rendered list, so suppressing a
section renumbers contiguously (no gap). A **computed** prose cross-ref (`exhibitLabelOf(id)` /
`pageNumOf(id)`) re-flows with it; a **hardcoded** "Exhibit J" does not — it silently points at
whichever section inherits that letter. This inventory flags the hardcoded ones. No source changed.

## Search commands + raw match counts
```
grep -rn "Exhibit " src/ | grep -v deckRegistry.js                         → 9   (mostly code comments; 2 rendered)
grep -rn "Appendix " src/ | grep -v deckRegistry.js                        → 0
grep -rnE "exhibitLabelOf|pageNumOf" src/ | grep -v deckRegistry.js        → 15  (5 imports + 3 DeckShell mechanics + 7 prose refs across 5 lines)
grep -rnE "exhibitLabelOf\('(equity|analyst|proforma)'\)|pageNumOf\('(equity|analyst|proforma)'\)" src/  → 0
```

## Rendered prose cross-refs

| File | Line | Verbatim (excerpt) | Target section | Hardcoded or computed? |
|---|---|---|---|---|
| SectionComparables.js | 487 | `…cited callouts on the Target Profile ({exhibitLabelOf('targetprofile')})…` | targetprofile | **Computed** (`exhibitLabelOf`) |
| SectionComparables.js | 487 | `…the Standalone P&L (§{pageNumOf('plAcquirer')}/§{pageNumOf('plTarget')})…` | plAcquirer, plTarget | **Computed** (`pageNumOf` ×2) |
| SectionTransactionStructure.js | 135 | `Exchange ratio & sensitivity: {exhibitLabelOf('exchange')}; historical implied ratio: {exhibitLabelOf('exchangeratio')}.` | exchange, exchangeratio | **Computed** (`exhibitLabelOf` ×2) |
| SectionTargetOverview.js | 165 | `…see Company Profiles (§{pageNumOf('profiles')}).` | profiles | **Computed** (`pageNumOf`) |
| SectionTargetOverview.js | 203 | `…see Standalone P&L — Target (§{pageNumOf('plTarget')}).` | plTarget | **Computed** (`pageNumOf`) |
| SectionExchangeRatioAnalysis.js | 141 | `…follow the stock-leg exchange ratio on {exhibitLabelOf('exchange')} — … per … share …` | exchange | **Computed** (`exhibitLabelOf`) |
| **SectionExchangeRatioAnalysis.js** | **141** | `…this page is the full price ratio; **Exhibit I** is the actual share issuance.` | exchange | **HARDCODED (live)** — literal `Exhibit I` |
| SectionStandalonePL.js | 324 | `<StandalonePLBody … exhibitLabel="Exhibit F" />` | plTarget (self-label) | **HARDCODED (dead)** — back-compat alias `SectionStandalonePL` (line 322-325); DeckShell wires only `SectionStandalonePLAcquirer`/`…Target` (DeckShell.js:15,40), so this alias is never rendered |

**Comment-only occurrences (NOT rendered cross-refs — excluded from counts):** DeckShell.js:28-29
(removed Exhibit N history), SectionProFormaPL.js:10,12 (Exhibit E/F comments),
SectionExchangeRatioAnalysis.js:15,30 (Exhibit I comments), PageFrame.js:51 (`{/* Exhibit label */}`).
DeckShell.js:189/197/242 use `exhibitLabelOf(section.id)` to ASSIGN each section its own label
(the mechanism, computed) — not prose cross-refs.

## Counts
- **Total rendered prose exhibit-label cross-refs: 9** references (across 6 lines) → **8 computed + 1 hardcoded (live)**.
- Plus **1 hardcoded (dead)** self-label in the unused back-compat alias (SectionStandalonePL.js:324).
- **Hardcoded: 2** (1 live `Exhibit I`, 1 dead `Exhibit F`). **Computed: 8.**
- **Cross-refs targeting the 5 named private-mode-suppressed sections (equity performance / stock
  price distribution / analyst consensus / pro forma trading profile / EPS accretion): 0.**
  No exhibit-label cross-ref points at `equity`, `analyst`, or `proforma` (grep confirmed empty).

## At-risk analysis (breaks first under private-mode suppression)

The 5 named suppressed sections are `equity` (K), `analyst` (M), and the pro-forma / EPS-accretion
group `proforma` (G) [current letters]. Zero refs point AT them. **But the letter arithmetic makes
one hardcoded ref break anyway:**

- **`SectionExchangeRatioAnalysis.js:141` hardcoded `Exhibit I` (→ `exchange`) — WILL BREAK.**
  `exchange` is currently Exhibit **I** (position: …proforma G, txnstructure H, exchange I). Suppressing
  `proforma` (a named-5 section, EPS accretion / pro forma) at position G shifts everything after it up
  one letter → `exchange` becomes **H**. The **same sentence** already reads `{exhibitLabelOf('exchange')}`
  (which self-corrects to "Exhibit H") **and** the literal "Exhibit I" (which does not) — so the prose
  becomes internally contradictory: "…the stock-leg exchange ratio on **Exhibit H** — … **Exhibit I** is
  the actual share issuance," both naming the same page. This is the concrete defect the phase targets.

- **Price-dependent exchange-ratio family (`exchange`, `exchangeratio`) — 4 refs point at it**
  (TransactionStructure.js:135 ×2 computed; ExchangeRatioAnalysis.js:141 ×1 computed + ×1 hardcoded).
  These sections need acquirer/target share prices to compute the ratio and are strong suppression
  candidates in private mode (not in the user's named-5, but flagged). If `exchange`/`exchangeratio`
  are themselves suppressed, `exhibitLabelOf('exchange')` returns **null** (`LABEL_MAP[id] || null`,
  deckRegistry.js:50) → the computed refs render an empty/`null` label; the hardcoded "Exhibit I"
  renders a stale letter. Either way the prose points at nothing valid.

## Recommendation (change nothing — findings only)
1. `SectionExchangeRatioAnalysis.js:141` — replace the literal `Exhibit I` with
   `{exhibitLabelOf('exchange')}` so both references in the sentence stay consistent under renumbering.
   (Highest priority — this one is live and breaks when `proforma` suppresses.)
2. `SectionStandalonePL.js:324` — the dead alias's hardcoded `Exhibit F` is latent, not live; delete
   the unused alias or thread the prop, at leisure.
3. When private mode suppresses `exchange`/`exchangeratio`, make the 4 refs pointing at them
   conditional on the target section's presence (guard on `exhibitLabelOf(id) != null`) so they omit
   rather than render an empty/stale label.
