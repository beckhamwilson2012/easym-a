# Unverifiable plan — every halt class, caught at preflight

Phase 1 is a working control, so a halt below cannot be blamed on the plan being broken
everywhere. Phases 2, 3 and 5 halt; phase 4 is skipped as already resolved. None of them
reaches runtime, and no agent is ever paid for one.

## phase 1: control — this one really is executable
  done:      normalize() distinguishes absent from zero
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10

## phase 2: verify names a script that is not on disk
  done:      the thing the missing check would have checked
  verify:    node planrunner/examples/checks/does-not-exist.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10

## phase 3: enter is false, so nothing runs at all
  enter:     test -f planrunner/examples/sandbox/prereq-that-is-not-there.js
  done:      would depend on a prerequisite that has not been built
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10

## phase 4: premise is already true at HEAD
  done:      safe.normalize() preserves null
  verify:    node planrunner/examples/checks/already-null-safe.js
  red:       fails
  touches:   planrunner/examples/sandbox/safe.js
  turns:     10

## phase 5: verify passes while asserting nothing
  done:      an invariant nobody actually checks
  verify:    MARKER=0 node planrunner/examples/checks/toggle-pass.js
  red:       none
  touches:   planrunner/examples/sandbox/safe.js
  turns:     10
