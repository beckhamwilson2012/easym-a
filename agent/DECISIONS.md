# Sweep decisions log

Plain-English statements of tripwire-worthy changes. Logged, not gated.

- [18:35:45 · run 20260816-165919 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:error_max_turns); reverted, item left OPEN.

- [18:38:33 · run 20260816-165953 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:error_max_turns); reverted, item left OPEN.

- [20:48:36 · run 20260816-202617 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:error_max_turns); reverted, item left OPEN.

- [22:47:50 · run 20260816-222441 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:success); reverted, item left OPEN.

- [16:37:40 · run 20260817-163640 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [16:56:09 · run 20260817-163640 · iter 1] iter 1 UNVERIFIED: agent edited files but the defect count did not move (9->9) and no revert_signal; committed as UNVERIFIED, queue item left OPEN (not checked off).

- [13:00:34 · run 20260916-124247 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [15:23:30 · manual edit · no run] run-sweep.sh: added `caffeinate -i -w $$` before the baseline capture. Run 20260916-124247 slept mid-capture and lost every deck to "Connection closed." (0 ok of 50, 409m). Sleep guard only — no grading, gate or queue logic touched.

- [15:41:10 · manual edit · no run] run-sweep.sh: added an exit contract — a completed run whose FINAL `capture END` summary reads `(0 ok)` now exits 2 instead of 0 (1 stays die()). Graded from loop.log, the same line sweep-watchdog.sh reads. Nothing about grading, gating, queue selection or capture changed: only the process exit code, so launchd's `last exit code` and the agents widget stop reporting a zero-deck run as ok.
