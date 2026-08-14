# Deferred findings register

Single home for findings surfaced but deliberately not fixed, so they stop living scattered across
stage audit appendices. Each was diagnosed with path:line evidence and left untouched on purpose.

**Patterns.** **A** = stale-but-present value blocks a fallback (a real value is there, but it's the
wrong/old one). **B** = null/absent coerced to 0 (or a proxy), producing a plausible wrong number.
**C** = `=== 0` / `!== 0` used as an absence check (holds only while the sentinel happens to be 0).

**🔒 = blocks private-company mode specifically** — i.e. manual entry / no ticker / no live data, the
mode where a company is modeled without a market feed. These fabricate or break precisely when there
is no live price or when sections are suppressed.

| ID | File:Line | Pattern | Description | Blocks what |
|----|-----------|---------|-------------|-------------|
| D1 | App.js:749 | B | Target market cap fabricated from `companyBEPS × 15` when no live target price — the direct analog of the acquirer proxy fixed in 11-C (App.js:781). | 🔒 **Private-company mode** — target valuation fabricated with no ticker. Mirror of the 11-C acquirer fix; do the target side. |
| D2 | dealCalc.js:38, :55 | A | A genuine reported EPS of 0 is treated as absent, so a real zero-EPS company falls through to a proxy/fallback instead of being modeled as zero. | Accurate accretion for genuine zero/near-zero-EPS companies (e.g. unprofitable targets). 🔒 partial — bites private mode if a modeled company truly has 0 EPS. |
| D4 | SectionTransactionStructure.js:108 | A | `transactionEV` re-derived locally (`equityPurchase + netCashDebt(...)`) past deckModel's deliberate null — bypasses the Fix A period-match guard, so it can render a period-mismatched EV. Same bug class as the §L ownership re-derivation fixed in 11-C. | Period-match honesty for the target's transaction EV. Needs its own consumer trace + period-basis check. |
| D5 | SectionExchangeRatioAnalysis.js:141 | cosmetic | Hardcoded "Exhibit I" cross-reference; the deck re-letters exhibits when a section is suppressed, so this text goes wrong. | 🔒 **Private-company mode** — suppressed sections shift exhibit letters and the hardcoded ref breaks. This is the Stage 11-D trigger. |
| D6 | SectionStandalonePL.js:324 | dead | Dead "Exhibit F" alias — computed, never rendered. | Nothing — cleanup only. |
| D7 | dealCalc.js:205 | convention | Returns the string `'N/A'` for an absent acquirer price, but the deck's rendered absence vocabulary is exactly `"—"` (absent) / `"n/m"` (deliberate). Currently unreachable in render (§I reads `A.price`, not `deal.acquirerSharePrice`). | Nothing today — latent. Would surface the moment any consumer renders `deal.acquirerSharePrice` directly; then it's a third absence token. |
| D8 | App.js:1120 | cosmetic | No symmetric "price unavailable" note for the new acquirer price input; the target input has one (e.g. App.js:351). | UI consistency for the acquirer input. |
| D9 | App.js:1281 | cosmetic | New acquirer price field label reads "…for premium calc" — premium is a target-side concept; the acquirer price actually drives share issuance and the exchange ratio. Target-specific wording on an acquirer field. | Label accuracy for the new input. |
| D10 | dealCalc.js:28 | dead | Dead `eps` binding, unused after the line-29 proxy removal (`no-unused-vars` warning). | Nothing — lint cleanup. |
| D11 | Yahoo/FMP company builders (~11 keys) | schema | Key drift between the Yahoo and FMP builders risks silent nulls where one provider names a field differently; wants a Phase-0 schema contract. | Data-source robustness across live providers (live-fetch modes). Not private mode. |
| D12 | App.js:649, 651, 652, 653, 657; :1254 | C | Offer / synergy `=== 0` used as absence checks; a genuinely-zero offer or synergy reads as "absent". | Correct handling of genuine-zero offer/synergy inputs. |

## Private-company-mode blockers (summary)

The mode this campaign is hardening (manual entry, no market feed) is blocked specifically by:

- **D1** — target market cap still fabricated from EPS×15 (the un-fixed twin of the 11-C acquirer work).
- **D5** — hardcoded "Exhibit I" breaks under the section suppression private mode uses (Stage 11-D).
- **D2** (partial) — genuine zero-EPS companies mis-modeled if one is entered.

Everything else is live-data accuracy, latent, or cosmetic.

## Investigated — not defects

Kept here so the trace isn't re-litigated later.

| ID | File:Line | Pattern | Description | Blocks what |
|----|-----------|---------|-------------|-------------|
| D3 | App.js:538, :578 | A | `data.sharePrice \|\| prev.X \|\| 0` preserves a live price against EDGAR responses that carry none — documented intent, comment at 535-537. **NOT REPRODUCIBLE as contamination:** `handleSelectA:521` clears price A on every ticker change; `handleReset:684` clears all inputs on the only auto→manual route; `prev` is the flat scalar inputs object, not a company blob, so radius is exactly the two price fields. Reproduction attempted (KO/PEP auto build → New Analysis → manual, acquirer price empty) → renders `"—"`, not KO's $87.71. Symmetry confirmed: `handleSelectB:563` mirrors 521. | Blocks nothing. Bounded, working as designed. |
