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

- [16:20:55 · run 20260917-161955 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [15:12:40 · manual edit · no run] **Baseline discontinuity 2026-09-17: capture.js re-pointed; runs before this date are not comparable.** capture.js drove the pre-`d1bfd2d` entry flow — it waited on an `Auto-Lookup` button and a `Build merger model` button, both removed 2026-08-20 — so every capture since has timed out 30s into stage `start` and produced 0 analyzable decks. Two selectors re-pointed, nothing else: `Public → Public` (chooseDealType('pubpub'), src/App.js:1498) and `Run Analysis` (src/App.js:1534). Timings, viewport, waits, oracle fetches and the record schema are untouched — 16 keys, identical across records, verified by scripts/capture-selftest.mjs on AAPL/VZ, KO/NSRGY and NET/DDOG (ok:true, stage:'done', pdfPages 17). This is a NEW baseline, not a re-baseline: there is no valid old capture set to compare against, every run since 2026-08-20 having scored 0 ok. Entry written 2026-09-21.

- [20:33:43 · run 20260922-194237 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [2026-09-24 · manual edit · no run] server.js: the `general` rate limiter (500 req / 15 min per IP on /api, /quote, /search) now skips loopback via server/utils/isLoopback.js. It exists to stop PUBLIC callers draining FMP/Anthropic quota; the sweep drives ~83 requests per deck × 50 decks from 127.0.0.1, so it exhausted that budget every run and the capture recorded OUR OWN 429 as a failed ticker load — 11 of the 12 failed decks in 20260922-194237. The llm tier (30/hr) is deliberately NOT skipped: those requests cost money wherever they come from. With `trust proxy` off, req.ip is the socket peer and cannot be forged remotely. Expect more analyzable decks per run from here: this changes how many decks survive capture, not what the graders measure.

- [16:43:15 · run 20260924-163754 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:success); reverted, item left OPEN.
