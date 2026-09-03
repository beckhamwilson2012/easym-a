# Small plan — a health module and a null coercion

The smallest plan that exercises both phase shapes: one new capability (`red: absent`)
and one bug fix (`red: fails`). Both are executable at HEAD.

## phase 1: add a health module
  done:      sandbox/health.js exports health() returning { ok: true, status: 'up' }
  verify:    node planrunner/examples/checks/health-endpoint.js
  red:       absent
  touches:   planrunner/examples/sandbox/health.js
  turns:     8
  tripwire:  node planrunner/examples/checks/tripwire-sandbox-intact.js

## phase 2: stop coercing absent to zero
  enter:     test -f planrunner/examples/sandbox/coerce.js
  done:      normalize() returns null for null and 0 for 0 — absent and zero are different states
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     12
