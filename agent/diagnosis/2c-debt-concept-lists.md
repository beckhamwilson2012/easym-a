# 2c — Three hand-maintained debt-concept lists have drifted apart (run 20260929-193005 iter 3)

## Repro (STEP 0)
Repro confirmed: `server/services/ltmCalc.js:57` still carries its own list
`debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations']`, which is not the shared resolver.

## State of the three call sites (read from the tree at ff9480b)
| site | what it uses for GAAP total debt |
|---|---|
| `server.js:723-727` (/quote) | `resolveTotalDebt(bsPick)` then `convertTotal` (`:698-700`: ConvertibleDebtNoncurrent/ConvertibleLongTermNotesPayable + ConvertibleDebtCurrent/ConvertibleNotesPayableCurrent) then `bsPick(['DebtLongtermAndShorttermCombinedAmount','LongTermLineOfCredit','LongTermNotesPayable'])` |
| `server/services/edgarClient.js:120-122` (§16) | `resolveTotalDebt(pickAtEnd…)` ONLY. No convertible tail, no LOC/notes tail. |
| `server/services/edgarClient.js:123-125` | a separate `debtRepEntry` list `['LongTermDebtNoncurrent','LongTermDebt','LongTermDebtAndCapitalLeaseObligations']` |
| `server/services/ltmCalc.js:57` (LTM `totalDebtM`, `:377`, `:415`) | its own first-match list; also not the shared resolver |

So the core LongTermDebt family is shared (a5511a9), but the convertible and non-LTD-total tails only live in
server.js. A filer whose only debt tag is one of those tails (IRDM's interim anchor is LongTermLineOfCredit only, SHOP is
convertibles, GME is LongTermNotesPayable, PGR is DebtLongtermAndShorttermCombinedAmount) resolves on /quote and comes back
null from `resolveTotalDebt` on §16 and in ltmCalc.

## Root cause
The resolver was shared, but server.js's fallback tails were never moved into `debtConcepts.js`, and ltmCalc was
never switched over. **Pattern: New** (vocabulary duplicated across call sites that drift apart; not stale/zero/accidental).

## Intended fix (NOT applied)
1. Add the two tails to `server/services/debtConcepts.js` as an ordered fallback inside `resolveTotalDebt`
   (the convertible sibling-sum with baseRequired=false, then first-match over
   DebtLongtermAndShorttermCombinedAmount / LongTermLineOfCredit / LongTermNotesPayable), so the result is the UNION.
2. Change `server.js:726-727` to `debtRes.value` only, delete `convertTotal`, and keep `siblingSum` if other code still uses it.
3. `edgarClient.js`: this call site picks up the union through the resolver, and `debtRepEntry` should get the same concept list.
4. `ltmCalc.js:57/377`: switch to `resolveTotalDebt` with an instantLatest-based pick.
   A single anchor date is needed for every component, because mixed instants would cause a period-matching problem.

## Why BLOCKED
Every file the fix must touch except server.js (`debtConcepts.js`, `edgarClient.js`, `ltmCalc.js`) is under
`server/services/`. CLAUDE.md says this directory "is being worked right now by a concurrent session … Do not edit
them without asking first." A headless run cannot ask. Moving only server.js's tails would require editing
`debtConcepts.js` anyway, so no partial landing avoids the directory.
