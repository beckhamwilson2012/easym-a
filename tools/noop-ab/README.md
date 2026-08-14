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

- `run.js` — drives the manual form from a recorded input set, builds the deck, writes every
  `[data-section-id]` innerText to `OUT`. Reports any input field the DOM did not expose
  (`missingInputs`) — a non-empty list means the two trees have different forms (see the trap below).
- `diff.js` — byte-compares two captures section-by-section; prints both strings for the first
  drifting section and exits non-zero.
- `ab.sh` — the driver: build → capture A → `git stash` the named files → build → capture B →
  restore → build → diff. Prints the CRA content-hash of each build.
- `../../STAGE_11C_NOOP_INPUTS.json` — the recorded input set (single source of truth for `run.js`).

## The input set

Manual entry, both companies fully populated, **acquirer share price = 150** (see the JSON for the
full set and per-field rationale). The pivot is `currentSharePriceA = 150`: with a price present,
every Stage 11-C-changed expression takes the *same* branch it took before the edits, so the whole
change is a provable no-op — any drift on this input is therefore a real defect, not data movement.
Non-zero stock consideration (40% stock → 69.3M new shares → 94%/6% split), 30% premium, and
non-zero synergies (600/960/1320) ensure the issuance, ownership, exchange-ratio, and accretion
paths all actually compute.

## Running it

```
# default: stash all four Stage 11-C files
tools/noop-ab/ab.sh

# or name the exact files to stash (see the trap below for why you'd subset them)
tools/noop-ab/ab.sh src/lib/deckModel.js src/utils/dealCalc.js \
                    src/components/deck/sections/SectionRelativeContribution.js
```

Expected: `BYTE-IDENTICAL across 17 sections`, `cErr=0 pErr=0` in both runs, and **two different
bundle hashes** (A ≠ B). Identical hashes mean the stash had no build effect and the diff is
vacuous — the script fails loudly on that.

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
