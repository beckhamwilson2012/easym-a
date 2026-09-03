'use strict';
// verify for: "absent must not render as zero" — red: fails.
// At HEAD coerce.js returns 0 for null, so this exits 1 WITH the marker: the assertions
// really ran and really failed. That is an establishable red.
const { normalize } = require('./../sandbox/coerce.js');
let asserted = 0, failed = 0;
const check = (label, got, want) => {
  asserted++;
  if (got !== want) { failed++; console.log('FAIL ' + label + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
  else console.log('ok   ' + label);
};
check('normalize(null) is null, not 0', normalize(null), null);
check('normalize(0) is still 0',        normalize(0),    0);
console.log('VERIFY:ASSERTED ' + asserted);
process.exit(failed ? 1 : 0);
