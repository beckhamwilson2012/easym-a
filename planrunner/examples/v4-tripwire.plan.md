# Tripwire plan — an invariant declared early, broken later

Phase 1 declares a plan-wide invariant that holds when declared. Phase 2 is graded by a
deliberately shallow verify that keeps passing even when the invariant is broken — the
limitation SPEC §7.1 names. The tripwire is what catches it, and it halts the whole plan,
so phase 3 must never run.

## phase 1: add a health module and declare the invariant
  done:      sandbox/health.js exports health() returning { ok: true, status: 'up' }
  verify:    node planrunner/examples/checks/health-endpoint.js
  red:       absent
  touches:   planrunner/examples/sandbox/health.js
  turns:     10
  tripwire:  node planrunner/examples/checks/tripwire-sandbox-intact.js

## phase 2: change safe.js under a shallow verify
  done:      safe.js still exports normalize
  verify:    node planrunner/examples/checks/safe-exports.js
  red:       none
  touches:   planrunner/examples/sandbox/safe.js
  turns:     10

## phase 3: must never run once the plan halts
  done:      normalize() preserves null
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10
