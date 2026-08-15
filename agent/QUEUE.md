# Sweep queue

<!-- Each item requires four fields: pair · observed · expected · source. An item without all
     four is not actionable and must not be moved out of Discovered. -->

## Open

- [ ]

## Closed

## Discovered

- KO/NSRGY — deck build fails at `loadA` (`Waiting failed: 80000ms exceeded`), flaky run-to-run.
  Runs only check #1 and skips checks 2–24, so the pair is NOT-ANALYZABLE (a distinct state from
  CLEAN — see GATE_SPEC.md §2/§4). Not to be "fixed" in this scaffold pass; the gate tolerates it as
  already-not-analyzable-at-baseline. (pair: KO/NSRGY · observed: checks_run=1, build timeout 80000ms ·
  expected: checks_run=24 · source: tools/sweep-analyzer/analyze.js loadA build step)
