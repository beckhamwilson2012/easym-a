'use strict';
// A DELIBERATELY SHALLOW verify: it checks only that safe.js still exports a normalize
// function, not what that function does. Used by the red: none tripwire test to show a
// phase preserving the invariant it was checked on while breaking one it was not —
// SPEC §7.1's stated limitation, caught by a tripwire rather than by the verify.
const m = require('./../sandbox/safe.js');
let asserted = 0, failed = 0;
const check = (label, ok) => { asserted++; if (!ok) { failed++; console.log('FAIL ' + label); } else console.log('ok   ' + label); };
check('safe.js exports normalize', typeof m.normalize === 'function');
console.log('VERIFY:ASSERTED ' + asserted);
process.exit(failed ? 1 : 0);
