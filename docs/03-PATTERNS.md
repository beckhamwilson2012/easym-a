# 03 — Recurring defect & instrument patterns (schema campaign)

Cross-cutting shapes that recurred across the coercion-census / wrapped-schema arc (Stages 14–15).
Each is a *class*, not a site — the sites live in DEFERRED.md and the stage records.

---

## P1 — A label passing without the work
A status/label/exhibit reference that *reads as done* without the underlying work having run or tied
out. Instances: the hardcoded "Exhibit I"/"Exhibit F" cross-refs (D5/D6, fixed) — text asserting a
relationship the registry no longer guarantees; and sweep item-18, where a passing label did not imply
the measured leg was actually present. The label is trusted more than the thing it labels.

## P2 — A wrapper stamping a coerced zero as verified (the inM instance)
`inM` coerces `null → 0` (`Math.round((val || 0)/1e6)`). So `field(inM(missing))` evaluates to
`field(0)` = `{value:0, status:'verified'}` — the honest-looking wrapper faithfully stamps a *fabricated*
0 as verified. The wrapper is only as honest as the value handed to it. Caught pre-edit in Stage 14/15
by refusing to convert through `inM` (the null-honest `toMillions` exists precisely to avoid this).

## P3 — The instrument was narrower than the thing measured (the `|| 0` grep)
Every coercion count in this arc came from a `grep "|| 0"` — **23**, then **15**. That instrument misses
`?? 0`, ternary `: 0`, and string coercions. On the EDGAR path it was *inversely correlated with
severity*: it counted `662` (a null-guarded, safe accumulator) and missed `601/603` (which fabricate
EPS). True numeric-fabrication total is **~22 (+47%)**; the shares `: 0` at old :794 and the diluted-EPS
`?? 0` were invisible to it. **The 23 and 15 are superseded floors, not counts.**

**General rule:** when a measurement and the thing measured can diverge, validate the measurement against
a known positive before trusting its output. (Here: a grep for one syntax cannot bound a multi-syntax
phenomenon — census every fabrication syntax, or the count is a floor.)

## P4 — Null-honesty is only worth what the consumers preserve
A boundary null-honesty fix is **unverifiable without tracing to the rendered surface.** Null can be
re-coerced to 0 (or made unreachable) at any layer up- or down-stream of the fix. Three instances in one
phase, each caught at a different layer:
- **Upstream (before the wrap):** `inM` coerced `null → 0`, so wrapping would stamp a fabricated 0 —
  caught *pre-edit*.
- **Sideways (the builder is inert):** the Yahoo builder is unreachable (FMP shadows it; Yahoo 429s), so
  its correct wrap never renders — caught *at the A/B* (D16).
- **Downstream (after the wrap):** `App.js:781` (`price * null → 0`) and `deckModel:79` (`shares || 0`)
  re-coerce a null share count back to 0, so the FMP `:794` wrap is server-honest but renders `$0` — caught
  *at the read-site trace*.

**Corrections entered against this arc:**
- **:794 was ranked "priority because visible."** Visibility was right; *priority* was wrong — its
  rendered fix lives at an off-limits read site (`App.js:781`/`deckModel:79`), not at the builder. Wrapping
  it is server-honesty only.
- **`pickOrNull` was proposed for FMP reuse — wrong abstraction.** It selects over EDGAR
  concept-namespaces (`pickOrNull(namespace, names)`); the FMP builder reads plain API values. The correct
  shared helper for FMP is `toMillions` (the dollars→$M converter), not the concept selector.

## P4-variant (Stage 16) — a null-honesty fix can CREATE a Pattern B
Making a value nullable is not safe in isolation: every **sum and ratio** that consumes it must be
guarded in the **same commit**, or the fix degrades the surface it was meant to repair. `deckModel:79`
(`A.shares || 0` → `A.shares`) fixed *alone* would have converted a **conspicuous** fabricated 0% pre-deal
ownership into a **plausible** fabricated number: `null + newShares` = `newShares` (JS coerces `null → 0`
in addition), so pro-forma shares look entirely normal while pre-deal ownership silently reads 0%. **A
fabrication that survives inspection is worse than a visible zero.** So `deckModel:82` was guarded
alongside `:79` (`preDealShares != null && newShares != null`); `:83/:84` already guarded
`proFormaShares > 0` → "—".

**Rule:** when making a value nullable, guard every sum and ratio consuming it in the same commit.

## Correction to the Stage-15 record — revenue/debt were NOT "effective"
Stage 15 / C2 reported all 8 non-shares FMP sites as "effective" (null → "—"). That is **FALSE for
revenue and debt**: null-safe on §B (read via `num()`), but re-coerced to `$0` on the §2 comps slide by
`SectionComparables:39` (`parseFloat(data.revenue) || 0`) and `:50/:118` (debt). Only **ebitda,
netIncome, eps, cash** are genuinely null-safe end to end. The §2-comps re-coercers are logged for a
section-file phase (DEFERRED **D17**).
