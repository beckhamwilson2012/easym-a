# PHASE 1 — ANALYZER AUDIT (24 items vs labels) — READ-ONLY

Legend: IMPL = implemented; PART = partial (some spec fields extracted but not compared, or only a subset compared); NONE = not implemented (no comparison; prints only or acknowledged N/A).

| # | spec fields | actually COMPARED in code | verdict | line(s) |
|---|---|---|---|---|
| 1 | builds · pages · console · page errors (verbatim) | all four; console sliced to 60ch, benign-429 separated | IMPL | 119-120 |
| 2 | NaN · undefined · null · Infinity · -0 · "$0"-misplaced · lone "%" | NaN, undefined, Infinity, $NaN/$undef/$null, (NaN\|null\|undef)% | PART | 123-130 |
| 3 | net debt = debt − cash − ST sec | oracle net-debt vs §2 target net-debt (chk) | IMPL | 146-148 |
| 4 | EV = equity + net debt | oracle EV vs §2 target EV (chk) | IMPL | 149-152 |
| 5 | equity = share price × shares | offer×shares vs §txn equity (chk); px×shares vs §2 equity only used as an input to #4, not separately flagged | IMPL* | 153-155 |
| 6 | EV / revenue | §2 EV ÷ oracle LTM rev vs §2 EV/Rev (chk) | IMPL | 156-159 |
| 7 | EV / EBITDA | §2 EV ÷ oracle LTM EBITDA vs §2 EV/EBITDA (chk) | IMPL | 160-163 |
| 8 | P / E | px ÷ oracle LTM EPS vs §2 P/E (chk) | IMPL | 164-167 |
| 9 | combined revenue = A LTM + B LTM | oracle A+B vs §2 rev-sum (chk) | IMPL | 168-172 |
| 10 | combined EBITDA = A + B + Y1 syn | prints A+B (FY, NO synergy add) + rendered; flags only the "non-positive" contradiction — no A+B+syn = rendered arithmetic/delta | PART | 190-196 |
| 11 | pro forma NI = A NI + B NI + aftertax syn − financing | reads a NARRATIVE string; no numeric extraction, no recompute, no compare | NONE | 188,197 |
| 12 | pro forma EPS = PF NI ÷ PF shares | prints a substring of the same narrative; "n/a" when it doesn't fire | NONE | 188,198 |
| 13 | accretion % = (PF − standalone)/standalone | only reports neg-base SUPPRESSION; never recomputes % or compares to rendered | NONE | 199-200 |
| 14 | exchange ratio = offer÷acqPx AND stock-leg ratio | offer-implied ratio vs §exchangeratio (chk); stock-leg ratio NOT computed | PART | 173-176 |
| 15 | sources total = uses total | parsed src vs uses, flags mismatch | IMPL | 177-179 |
| 16 | new debt = cashConsid + tgtDebtRepaid − excessCash (floored) | prints cashConsid + rendered + debt-null note; does NOT compute excessCash/floored new-debt or a delta | PART | 180-182 |
| 17 | LTM rev AND LTM NI = annual + latest interim − prior interim (3 legs) | prints composed LTM + trusted flag; explicitly "leg-level N/A" — legs never captured/verified | NONE | 184-185 |
| 18 | revenue · cost of revenue · gross profit · gross margin (cross-surface) | REVENUE only (Δrev B); COGS/GP/GM never compared; §2-vs-§6/§7/§8 asymmetry never checked | PART | 205 |
| 19 | operating income · EBITDA · net income · EPS (cross-surface) | prints §2 EV/EBITDA + oracle EBITDA/EPS; ZERO comparisons, no op-income, no NI, no EPS cross-surface | NONE | 206 |
| 20 | shares · cash · total debt · net debt · EV · market cap (cross-surface) | DEBT (quote vs §16 vs §2 + DROPPED flag), net debt (#3), EV (§2 vs §txn), equity/mktcap (withheld detector); shares NOT compared; cash NOT compared (verifCashV extracted L112 but never used) | PART | 203-247 |
| 21 | total assets · accretion · exchange ratio · premium (cross-surface) | premium (mine vs rendered, printed not flagged), exch ratio (from #14); total assets NEVER compared (oracle.totalAssets unused); accretion cross-surface (dashboard vs §7) NEVER compared | PART | 247 |
| 22 | every "—"/n.m: field · section · WHY; flag any hiding a figure elsewhere | COUNTS "—" per section + one debt-specific KEY line; no per-field enumeration, no general hides-a-figure detection | PART | 250-252 |
| 23 | accretive/dilutive claim off ≤0 base | detects acquirer loss-making → accretion suppressed | IMPL | 199,253 |
| 24 | banks suppress EV/EBITDA · restaurants split · foreign FX · neg-equity DCF — each fires AND does-not-fire | reports 4 signals; NO fires-where-expected/doesn't-fire verification; restaurant company-op/franchise split NOT checked at all | PART | 254-259 |

*#5: verifies transaction equity (offer×shares vs §txn) which ties exactly; the spec's market equity (px×shares vs §2 equity) is only an intermediate in #4, not an independently-flagged comparison.

## Items 11/12 extraction code (verbatim)
```
188: const narr = (body.match(/moves pro forma EPS from \$-?[\d.]+ to \$-?[\d.]+[^\n]*/) || [''])[0];
197: add(11, `Pro forma NI: (needs financing/tax internals) — narrative: "${narr || 'n/a'}"`);
198: add(12, `Pro forma EPS: from narrative "${narr ? narr.replace('moves pro forma EPS ', '') : 'n/a'}"`);
```
Should read the rendered NUMERIC dashboard fields instead: `labeled(body, /Pro Forma Net Income/)` and
`labeled(body, /Pro Forma EPS/)` (both are labeled $ values on the dashboard — GOOGL/AMZN renders
"Pro Forma EPS 8.38"). The string parse is fragile because that sentence is emitted only in certain
accretion states — the "moves pro forma EPS from $X to $Y" phrasing appears for the loss-making / n-m
narrative but NOT for a clean positive-accretion deal, so the regex misses and returns "n/a"
(exactly what happened on GOOGL/AMZN).

## Tally
IMPLEMENTED: 10 → items 1,3,4,5,6,7,8,9,15,23
PARTIAL:      9 → items 2,10,14,16,18,20,21,22,24
NOT IMPL:     5 → items 11,12,13,17,19
