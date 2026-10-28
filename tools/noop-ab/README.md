# Deterministic no-op A/B harness

The standing no-op gate for every future fix phase. Proves a change does **not** alter the deck
on the paths it is supposed to leave untouched — by byte-diffing the rendered deck with the edits
vs. without them, on a fixed, offline input set.

## Why this replaces the live-baseline approach

The prior gate (`STAGE_11A_BASELINE.json`) froze a ticker-path capture and diffed future runs
against it. That is **structurally unusable**: ticker decks depend on live market data, which
drifts (e.g. CRM $193.79 → $215.77 over four days). Every byte difference is data movement, not
code, so a frozen live baseline can never be byte-identical again and proves nothing.

**Manual entry performs no network fetch.** Identical inputs → identical deck, always. So a
with-edit vs without-edit manual capture isolates *code* behavior with zero data confound. Do not
re-freeze a live baseline; use this instead.

## Files

- `run.js` — drives the app from an input fixture, builds the deck, writes every
  `[data-section-id]` innerText to `OUT`. FAILS the run (never warns) on: an input the DOM did not
  expose, a stub miss, or a section count that differs from the fixture.
- `flow.js` — the shared UI driver, used by BOTH `run.js` and `record.js` so the recorder and the
  gate drive the app identically. The flow is data (the fixture's `flow` block), not code.
- `stub.js` — record/replay for every same-origin data route (`/api/*`, `/quote`, `/search`).
  Page-level interception in Puppeteer: no app or server code is aware of it, so there is no stub
  path that could ship.
- `record.js` — the ONLY script that touches the network. Run it by hand to refresh the public
  fixture; `ab.sh` never calls it.
- `diff.js` — byte-compares two captures section-by-section; prints both strings for the first
  drifting section and exits non-zero.
- `ab.sh` — the driver: build → capture A (every fixture) → `git stash` the named files → build →
  capture B → restore → build → diff each fixture. Prints the CRA content-hash of each build.
- `fixtures/public-NET-DDOG-responses.json` — the recorded network fixture (generated; do not
  hand-edit). 50 responses, ~77 KB.
- `../../STAGE_11F_PUBLIC_NOOP_INPUTS.json` — public input set, 17 sections. `run.js`'s default.
- `../../STAGE_11E_PRIVATE_NOOP_INPUTS.json` — private input set, 16 sections, no network at all.
  Each fixture's `flow` block carries the entry-flow wiring: the deal-type button, the ticker
  pickers (public only), the run button, the first input to await, the final section, the expected
  section count, and the stub file to replay.
- `../../STAGE_11C_NOOP_INPUTS.json` — **historical only**, kept as the record of the 11-C gate. Not
  runnable: see "Entry-flow repair" below.

## Entry-flow repair (2026-10-26)

`run.js` clicked a **"Manual Entry"** button and typed 20 fields. Commit `d1bfd2d` (2026-08-20,
*"feat(entry-flow): deal-type-first entry"*) replaced the entry screen with a deal-type choice
(Public→Public / Public→Private / Private→Private) and removed that button — "Manual Entry" survives
in `src/` only as a comment on `App.js:143`. The harness was written 2026-08-14, six days earlier, so
it had been dead for ~2 months, failing at `waitForFunction(/Manual Entry/)` after 30s. **The gate
could not run at all during that window.**

Ten of the 11-C fixture's twenty fields no longer exist as form inputs on any path
(`companyAShares` / `companyAEPS` / `currentSharePriceA`, the B-side equivalents, `offerPricePerShare`)
— a private company has no share count, EPS or per-share price — which is why 11-C was replaced
rather than re-pointed.

`run.js` now takes the flow from the fixture, fills inputs in **two passes** (the private panel
renders the deal fields only once the fundamentals are populated, so one pass reports them missing
and silently runs different effective inputs), and throws if any input stays missing or the captured
section count differs from the fixture — so a wrong-shape deck fails at capture instead of yielding a
vacuously-passing diff.

## The input set

Manual entry on the **Private → Private** path, both companies fully populated (see the JSON for the
full set and per-field rationale). Non-zero stock consideration, synergies (600/960/1320) and a
total offer value ensure the ownership, leverage and accretion paths actually compute.

### Two fixtures, because neither shape alone covers the deck

Only the private paths accept typed fundamentals, so `privpriv` is deterministic by construction —
but it sets `hasMarketData:false`, and DeckShell then suppresses `equity` / `analyst` /
`exchangeratio` and promotes `privatevaluation` + `contribution`: the **private 16-section deck**.

**Public → Public is ticker-only**, and a live ticker fetch is the market drift that made the frozen
baseline worthless. The public fixture gets determinism a different way: `stub.js` replays a
recorded response for every same-origin data route, and replay **hard-fails on any miss** so the
fixture can never quietly fall through to the live network. Verified: two independent captures on one
build are byte-identical across all 17 sections, prices included.

Coverage, measured against the registry: **19 of 21 registered sections**. The two that are not
covered are `execsummary` and `dashboard` — both `showInPdf:false`, so by construction they never
appear in the hidden PDF tree the harness captures. Every `showInPdf` section is covered.

(Loading a saved analysis was considered as a way to seed a public deck offline and does not work:
`savedAnalyses` is in-memory `useState([])`, never persisted, so it cannot be seeded externally.)

## Running it

A server must be serving the build on `http://localhost:3001` (`node server.js`); override with
`BASE_URL`.

```
# name the exact files to stash — the edits under test (see the trap below for why you'd subset them)
tools/noop-ab/ab.sh src/components/deck/deckRegistry.js src/components/deck/DeckShell.js
```

Expected, for EACH fixture: `BYTE-IDENTICAL across 17 sections` (public) / `16 sections` (private),
with `cErr=0 pErr=0`, `missing=[]` and `stubMisses=0` in both runs, and **two different bundle
hashes** (A ≠ B). Identical hashes mean the stash had no build effect and the diff is vacuous — the
script fails loudly on that. `ab.sh` exits non-zero if either fixture drifts.

`ab.sh` has no no-arg default: it used to stash the four Stage 11-C files, which are no longer the
files anyone tests, and stashing the wrong set yields a vacuous or actively misleading pass. Name
the files your change edited.

Refresh the public network fixture (the only networked step) with:

```
node tools/noop-ab/record.js
```

A slide registered `showInPdf:false` is invisible to this gate: `run.js` captures
`[data-section-id]` nodes, which exist only in DeckShell's hidden PDF tree. Byte-identity then proves
nothing was broken, and nothing about the new slide — verify that separately.

## Trap discovered in Stage 11-C — a change that *adds an input field*

If the change under test adds a form field (11-C added `currentSharePriceA`), you **cannot** stash
all the edited files and expect byte-identity: the un-edited tree has no such field, so `run.js`
cannot set that input in run B (`missingInputs: ["currentSharePriceA"]`), and run B silently runs a
different effective input. The diff then shows drift confined to whatever that input drives — a
**test-design confound, not a code defect**.

The fix: **hold the form file (`App.js`) constant across both runs and stash only the behavioral
files.** Both runs can then set the new input identically, isolating the behavioral change. The
form file's own price-present behavior is a no-op by construction (the added field is additive; the
branches it touches reduce to the same value when the price is present) and is covered by the
price-absent positive controls, not by this byte-diff.

Rule of thumb: **stash only files whose edits do not change the set of inputs the form exposes.**
