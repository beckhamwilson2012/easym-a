# Touches plan — one phase, scoped to one file

## phase 1: stop coercing absent to zero, without touching anything else
  done:      normalize() preserves null and keeps a real zero
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10
