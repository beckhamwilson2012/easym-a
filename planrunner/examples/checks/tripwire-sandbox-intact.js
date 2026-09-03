'use strict';
// A plan-wide invariant: the already-correct helper must stay correct. Re-run after
// every phase from the one that declares it (SPEC §5). Holds at HEAD.
const { normalize } = require('./../sandbox/safe.js');
if (normalize(null) !== null) { console.log('TRIPWIRE VIOLATED: safe.normalize no longer preserves null'); process.exit(1); }
console.log('tripwire ok: safe.normalize preserves null');
process.exit(0);
