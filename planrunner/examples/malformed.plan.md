# Malformed plan — every parser rejection in one file

Nothing here should produce a default. Each phase is wrong in a different way.

## phase 1: verify is missing entirely
  done:      a phase with nothing to grade it
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     5

## phase 2: red is not one of the three states
  done:      x
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       maybe
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     5

## phase 3: turns is not an integer
  done:      x
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     as many as it takes

## phase 4: empty value, unparseable command, duplicate key, unknown key, stray line
  done:
  verify:    node planrunner/examples/checks/null-not-zero.js &&
  red:       fails
  red:       none
  touches:   planrunner/examples/sandbox/coerce.js
  turns:     5
  budget:    50
  this line is not a field and must not be skipped

## phase 5: touches names the runner's own code
  done:      x
  verify:    node planrunner/examples/checks/null-not-zero.js
  red:       fails
  touches:   planrunner/preflight.js
  turns:     5
