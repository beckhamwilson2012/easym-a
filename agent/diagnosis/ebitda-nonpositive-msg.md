# Item 3 — False "Combined EBITDA is non-positive" (D-ebitdaMsg)

Run `20260929-193005`, iteration 4. Verdict: **PARTIAL — the class split; no code change made** (STEP 0 split rule).

## STEP 0 — repro against the runner's latest capture (`cap/before-4`, the current tree)

Named pair **NET/DDOG does NOT reproduce**: the message is absent. §4 Debt / EBITDA renders `74.7x | 1222.5x`
and Combined EBITDA (incl. Y1 synergies) is `$57M`. So `combinedDebt` is non-null now, which points to the
upstream debt items (2a/2b/2c, iters 1–3 of this run).

The **class still reproduces on other pairs**. SAP/NOW, dashboard card:
`DEBT / EBITDA ⓘ n/m  Combined EBITDA is non-positive`, while the same deck renders Combined EBITDA
(incl. Y1 synergies) = **$8,692M**.

Full tally for `cap/before-4` (scratch `tally_ebitdamsg.js`: message present · Combined EBITDA cell · §4 Debt/EBITDA cells):

| Group | Pairs (Combined EBITDA) |
|---|---|
| **False: message fires, EBITDA positive (9)** | ARM/SNPS $2,865M · CART/DASH $2,333M · CMCSA/PARA $36.9B · F/RIVN $4,112M · PLTR/SNOW $319M · RDDT/PINS $887M · SAP/NOW $8,692M · TM/GM $44.0B · WBD/PARA $6,405M |
| **Wrong reason: message fires, EBITDA N/A so sign unknown (8)** | BRK.B/PGR · BX/APO · GSK/NUVL · LLY/SRPT · MRNA/BNTX · SHEL/OXY · SONY/EA · UL/CL |
| Correct: message fires, EBITDA negative (2) | CRWD/S ($539M) · RBLX/U ($988M) |
| Resolved upstream | NET/DDOG $57M → 74.7x |

## Root cause (from source; not changed)

- `src/components/deck/sections/SectionDashboard.js:260`:
  `note: results.debtEBITDA === 'N/A' ? 'Combined EBITDA is non-positive' : null`. It keys the note on the
  *output* being N/A and never reads the EBITDA sign.
- `src/utils/dealCalc.js:194`: `debtEBITDA = (combinedEBITDA > 0 && combinedDebt != null) ? … : null`. N/A has
  three causes: EBITDA ≤ 0, EBITDA null (`dealCalc.js:152`, either side null), or combinedDebt null
  (`dealCalc.js:193`, either debt null).
- One sentence: the dashboard note names one of three N/A causes as though it were the only one, so a
  null-debt or null-EBITDA N/A is labelled "non-positive". **Pattern New**: a message keyed to a sentinel
  that merges distinct absence states. It is close to Pattern C: the text is only true by accident, when
  EBITDA happens to be negative.

Side observation, not investigated: several "false" pairs render a real §4 Debt/EBITDA (e.g. SAP/NOW
`0.6x | 12.2x`, F/RIVN `1.1x | 0.0x`) while the §3 dashboard card says n/m. So the §4 table and
`results.debtEBITDA` source combined debt from different places.

## What remains (for the next iteration)

Branch the SectionDashboard.js:260 note on the actual cause, reading `results.combinedEBITDA` (already
returned as a string or null at `dealCalc.js:225`):
- EBITDA null → "not available" (or name the missing input)
- EBITDA ≤ 0 → "Combined EBITDA is non-positive"
- EBITDA > 0 and debt null → "Combined debt not available"

Acceptance: no pair in the first two groups shows "non-positive", and CRWD/S and RBLX/U still do.
The EV/EBITDA card (`:248`) already uses this branching shape and can serve as the model.
