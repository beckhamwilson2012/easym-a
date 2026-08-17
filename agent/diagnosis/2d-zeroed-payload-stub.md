# 2d — Unresolved companies get a zeroed payload stub instead of nulls

Run `20260817-163640` · pair **BRK.B/PGR** · root class: *null-is-not-zero, at the payload level*

## STEP 0 — repro

Live probe against the running app, before any edit:

```
node -e "fetch('http://127.0.0.1:3001/quote?symbol=BRK.B')…"
{"name":"BRK.B","dataSource":"none","companyType":"standard",
 "revenue":0,"ebitda":0,"netIncome":0,"shares":0,"eps":0,"cash":0,"debt":0,
 "ltm":{"trusted":false,"fallback":"annual","reason":"no data source resolved"}}
```

**Repro confirmed: `revenue: 0` (and six more zeros) for BRK.B with `dataSource:"none"`** — matches the
item's stated observation exactly. One matching value ends STEP 0.

## Root cause

`server.js:1030` — when EDGAR, FMP and Yahoo all return null, the `/quote` handler returned a
hand-written default object literal that assigns **`0`** to `revenue, ebitda, netIncome, shares, eps,
cash, debt`, and returned it via an **early `res.json()` that bypasses the `unwrapCompany` boundary**
every resolved result goes through.

**Pattern B** — a null (absent data) coerced to zero, producing a plausible wrong number. It is
Pattern B at the *payload* level rather than the field level, which is what makes it upstream of item
2b: a per-field `|| 0` guard can never fire on a value the stub already materialised as a real `0`.

Two properties made it survive every existing control:

1. **Invisible to both graders.** `docs/sweep-v2/captures/BRK.B_PGR.json` is `ok:true` — a zeroed
   payload renders as a well-formed deck full of real-looking numbers, so defect count does not rise
   and no cell looks malformed.
2. **Invisible to plausibility heuristics.** `$0 revenue` is a legal value; a filer can genuinely
   report zero. Only `dataSource:"none"` distinguishes the stub from a real zero.

## Trace — source → wire → render

| Hop | Before | After |
|---|---|---|
| `server.js` no-provider branch | literal `revenue: 0` | `field(null, {source:'none'})` → `{value:null, status:'missing'}` |
| `/quote` wire (via `unwrapCompany`) | `revenue: 0` | `revenue: null` |
| `src/App.js:527` `companyARevenue: data.revenue` | `0` | `null` |
| `fmtMoney` / `fmtMoneyTable` (`deckTokens.js:19,35`) | `"$0"` | `"N/A"` |

The formatters already return `'N/A'` on `null | undefined | NaN`, so nulling the payload propagates
to honest blanks with no render-layer change required. `src/App.js:332` already renders the
`dataSource === 'none'` warning banner ("No financial data found. Enter figures manually below.").

## Fix

`server.js` no-provider branch now builds the stub from the canonical `field()` factory — the same
single-source-of-truth wrapper whose contract is *"missing → null, real 0 → 0"* — and returns it
through the **same `unwrapCompany` boundary** as every resolved result, removing the parallel exit.

Verified as a pure-module check (no server restart — the runner owns that):

```
WIRE: {"name":"BRK.B","dataSource":"none",…,"revenue":null,"ebitda":null,"netIncome":null,
       "shares":null,"eps":null,"cash":null,"debt":null,
       "ltm":{…,"reason":"no data source resolved"}}
REAL ZERO: {"revenue":0}      ← a genuine 0 still survives the boundary as 0, not null
all null: true · markers intact: true
```

### Deliberately kept

- `dataSource: 'none'` and `ltm.reason: 'no data source resolved'` — these are the **honest markers**,
  and per the item any future check for this defect must key on `dataSource:"none"` specifically.
- `name: symbol` — the ticker is the caller's own input echoed back as a label, not a sourced datum;
  `src/App.js:324` needs it for the "✓ … loaded" line that carries the warning banner. No financial
  figure is fabricated by it.
- `companyType: 'standard'` — a behaviour selector (drives `isFinancial`), not a reported figure.

### Crash risk checked

`null.toFixed()` throws where `0.toFixed()` did not. The only `.toFixed()` calls on these fields are
`SectionStandalonePL.js:423,513,520`, all guarded by `shares > 0`; `null > 0` is `false`, so they take
the `'N/A'` branch. No other read site calls a method directly on a `/quote` numeric field.

## Note for the next iteration

This fix is **not observable to either grader** — that is the nature of the defect, not a gap in the
work. The evidence is the wire shape above. It also *unblocks* item 2b: the render-boundary `|| 0`
guards now receive `null` instead of a real `0`, so they are reachable for the first time.
