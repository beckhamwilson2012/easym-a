# Drift plan — a phase whose red will not go red

Preflight sees phase 2's verify FAILING at HEAD, so it classifies it executable. By the
time phase 2 actually runs, phase 1 has already fixed the same subject, so its red swap
restores a checkpoint that already passes. That drift is invisible to preflight and is
exactly what the runner-established red is for. Phase 3 is on a different subject and
must still run.

## phase 1: stop coercing absent to zero
  done:      normalize() preserves null and keeps a real zero
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10

## phase 2: a second phase on the same subject
  done:      something phase 1 has already achieved
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10

## phase 3: an unrelated subject — must still run
  done:      safe.js keeps exporting normalize
  verify:    node planrunner/examples/checks/safe-exports.js
  red:       none
  touches:   planrunner/examples/sandbox/safe.js
  turns:     10

## phase 4: the same subject as the halted phase — must be skipped, not attempted
  done:      anything further to coerce.js
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10
