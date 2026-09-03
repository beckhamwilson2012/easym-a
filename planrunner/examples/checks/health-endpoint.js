'use strict';
// verify for: "add a health module" — red: absent.
//
// THE REQUIRE IS DELIBERATELY UNGUARDED. At HEAD sandbox/health.js does not exist, so
// node throws MODULE_NOT_FOUND and exits 1 having printed no marker. That is precisely
// the case SPEC §2b exists for: exit 1 that is NOT an assertion failure. Guarding it
// would hide the very failure mode this fixture demonstrates.
const health = require('./../sandbox/health.js');
let asserted = 0, failed = 0;
const check = (label, got, want) => {
  asserted++;
  if (got !== want) { failed++; console.log('FAIL ' + label + ': got ' + JSON.stringify(got)); }
  else console.log('ok   ' + label);
};
check('health() reports ok',     health.health().ok,     true);
check('health() reports status', health.health().status, 'up');
console.log('VERIFY:ASSERTED ' + asserted);
process.exit(failed ? 1 : 0);
