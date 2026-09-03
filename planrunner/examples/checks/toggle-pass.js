'use strict';
// THE V6 FIXTURE. Exits 0 either way. The ONLY difference between the two runs is
// whether the marker line is printed, so a classification difference can be caused by
// nothing else. MARKER=1 -> accepted; MARKER=0 -> rejected as asserting nothing.
console.log('doing something that looks like work');
if (process.env.MARKER === '1') console.log('VERIFY:ASSERTED 1');
process.exit(0);
