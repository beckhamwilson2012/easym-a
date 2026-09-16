# Kill plan — one long phase, to be interrupted

## phase 1: a phase that writes its work and then hangs
  done:      normalize() preserves null
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     10
