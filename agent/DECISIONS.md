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

- [16:49:08 · run 20260924-164351 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:success); reverted, item left OPEN.

- [17:06:57 · run 20260924-170138 · iter 1] iter 1 NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (error-envelope:success); reverted, item left OPEN.

- [16:17:03 · run 20260929-160247 · iter 1] iter 1 DONE_TESTED: the count could not move (6->6) but agent/tests/2b-null-not-zero.js fails at the checkpoint and passes on this tree, so the fix is measured rather than merely unmeasurable; item closed.

- [21:50:19 · run 20260929-193005 · iter 1] iter 1 REGRESSION per GATE_SPEC §2(b): DAL/ALK was analyzable in the before-capture and is not in the after-capture; a lost sample is breakage, not an improvement.

- [22:48:31 · run 20260929-193005 · iter 2] iter 2 PARTIAL returned edits, which its contract forbids; reverted unmeasured rather than committing work no capture scored.

- [22:48:31 · run 20260929-193005 · iter 2] iter 2 PARTIAL: server.js and edgarClient.js already share resolveTotalDebt via a5511a9, so the core LongTermDebt-family vocabulary is one list, and RKLB/IRDM are non-null on both /quote and §16 / remaining: move server.js:698-700 and :726-727 fallback concepts (ConvertibleDebtNoncurrent, ConvertibleLongTermNotesPayable, ConvertibleDebtCurrent, ConvertibleNotesPayableCurrent, DebtLongtermAndShorttermCombinedAmount, LongTermLineOfCredit, LongTermNotesPayable; item left OPEN with the remaining half recorded, breaker untouched.

- [11:27:49 · run 20260929-193005 · iter 3] iter 3 REGRESSION: defect density rose 1.18 -> 1.24 per analyzable pair after the change (test-graded: 0); reverted, item parked. §2(b) held and no pair rendered less, so the rise is attributed to the change itself.

- [11:58:33 · run 20260929-193005 · iter 4] iter 4 PARTIAL returned edits, which its contract forbids; reverted unmeasured rather than committing work no capture scored.

- [11:58:33 · run 20260929-193005 · iter 4] iter 4 PARTIAL: NET/DDOG resolved upstream: Debt/EBITDA now 74.7x, no message / SectionDashboard.js:260 note still fires "Combined EBITDA is non-positive" on 17 pairs where combined EBITDA is positive or N/A. 9 positive: ARM/SNPS, CART/DASH, CMCSA/PARA, F/RIVN, PLTR/SNOW, RDDT/PINS, SAP/NOW $8,692M, TM/GM, WBD/PARA. 8 N/A: BRK.B/PGR, BX/APO, GSK/NUVL, LLY/SRPT, MRNA/BNTX, SHEL/OXY, SONY/EA, UL/CL. Fix: branch the note on results.combinedEBITDA (null → not available; ≤0 → non-positive; >0 with combinedDebt null → combined debt not available; item left OPEN with the remaining half recorded, breaker untouched.

- [16:18:20 · run 20260929-193005 · iter 6] iter 6 UNVERIFIED: agent edited files but the defect count did not move (54->54) and no revert_signal; committed as UNVERIFIED, queue item left OPEN (not checked off).

- [16:48:51 · run 20260929-193005 · iter 7] iter 7 REGRESSION: defect density rose 1.10 -> 1.16 per analyzable pair after the change (test-graded: 0); reverted, item parked. §2(b) held and no pair rendered less, so the rise is attributed to the change itself.

- [20:18:54 · run 20260930-193438 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [11:38:35 · run 20261007-113735 · iter ?] Prices not frozen at startup; capture mode = 2N.

- [12:07:00 · run 20261007-113735 · iter 1] iter 1 BLOCKED: queue item names no parseable repro pair, so no measurement is possible; parked without agent work.
