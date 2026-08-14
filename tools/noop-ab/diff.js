// Compare two no-op captures section-by-section. Exit 0 iff every section's innerText is
// byte-identical AND both have the same section set. Prints per-section verdict; on any drift,
// prints both strings for the first differing section (paste-ready) and exits 1.
const fs = require('fs');
const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) { console.error('usage: node diff.js <A.json> <B.json>'); process.exit(2); }
const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));

const aIds = Object.keys(A.sections), bIds = Object.keys(B.sections);
console.log(`A[${A.label}] sections=${aIds.length} cErr=${A.cErr.length} pErr=${A.pErr.length}`);
console.log(`B[${B.label}] sections=${bIds.length} cErr=${B.cErr.length} pErr=${B.pErr.length}`);

let drift = 0;
const allIds = [...new Set([...aIds, ...bIds])];
for (const id of allIds) {
  const a = A.sections[id], b = B.sections[id];
  if (a === undefined || b === undefined) {
    console.log(`  DRIFT ${id}: present in ${a === undefined ? 'B only' : 'A only'}`);
    drift++;
    continue;
  }
  if (a !== b) {
    console.log(`  DRIFT ${id}: innerText differs (A ${a.length} chars, B ${b.length} chars)`);
    if (drift === 0) {
      console.log('\n----- A[' + id + '] -----\n' + a);
      console.log('\n----- B[' + id + '] -----\n' + b + '\n');
    }
    drift++;
  } else {
    console.log(`  ok    ${id} (${a.length} chars identical)`);
  }
}

if (drift === 0) console.log(`\nRESULT: BYTE-IDENTICAL across ${allIds.length} sections. No-op confirmed.`);
else console.log(`\nRESULT: ${drift} section(s) drifted. NOT a no-op — investigate.`);
process.exit(drift === 0 ? 0 : 1);
