'use strict';
// verify for a phase whose premise is ALREADY TRUE at HEAD. Declared red: fails, but
// safe.js is correct already, so this exits 0 with the marker and preflight reports
// RESOLVED_UPSTREAM — a skip, not a halt (ITERATION_PROMPT.md:124-127).
const { normalize } = require('./../sandbox/safe.js');
let asserted = 0, failed = 0;
const check = (label, got, want) => {
  asserted++;
  if (got !== want) { failed++; console.log('FAIL ' + label); } else console.log('ok   ' + label);
};
check('normalize(null) is null', normalize(null), null);
check('normalize(0) is 0',       normalize(0),    0);
console.log('VERIFY:ASSERTED ' + asserted);
process.exit(failed ? 1 : 0);
