// DIAGNOSTIC (Fix 10a): read the exhibitLabel of each section IN DECK ORDER and flag collisions /
// non-sequential letters. The labels are hardcoded per-file and currently collide (two A, two B,
// two C, three F, two E, two G).
import { readFileSync } from 'fs';
const dir = new URL('../src/components/deck/sections/', import.meta.url);

// Deck order from DeckShell.SECTIONS (showInPdf only; title page has no exhibit label).
const ORDER = [
  ['#2 comparables',  'SectionComparables.js'],
  ['#3 profiles',     'SectionCompanyProfiles.js'],
  ['#4 plAcquirer',   'SectionStandalonePL.js:Acquirer'],
  ['#5 plTarget',     'SectionStandalonePL.js:Target'],
  ['#6 finprofile',   'SectionFinancialProfile.js'],
  ['#7 proforma',     'SectionProFormaPL.js'],
  ['#8 equity',       'SectionPricePerformance.js'],
  ['#9 trading',      'SectionTradingProfile.js'],
  ['#10 contribution','SectionRelativeContribution.js'],
  ['#11 distribution','SectionFootballField.js'],
  ['#12 analyst',     'SectionAnalystConsensus.js'],
  ['#13 valuation',   'SectionAVP.js'],
  ['#14 sources',     'SectionSources.js'],
  ['appendix verif',  'SectionDataVerification.js'],
];

function labelOf(spec) {
  const [file, variant] = spec.split(':');
  const src = readFileSync(new URL(file, dir), 'utf8');
  if (variant) {
    // StandalonePL wrappers: pick the line for the given role.
    const line = src.split('\n').find(l => l.includes(`role="${variant}"`));
    const m = line && line.match(/exhibitLabel="([^"]+)"/);
    return m ? m[1] : '(?)';
  }
  const m = src.match(/exhibitLabel="([^"]+)"/);
  return m ? m[1] : '(?)';
}

const seen = {};
const labels = ORDER.map(([name, spec]) => {
  const lbl = labelOf(spec);
  seen[lbl] = (seen[lbl] || 0) + 1;
  return { name, lbl };
});

console.log('Deck-order exhibit labels (CURRENT):');
labels.forEach(({ name, lbl }) => {
  const dup = seen[lbl] > 1 && lbl.startsWith('Exhibit');
  console.log(`  ${name.padEnd(18)} ${lbl}${dup ? '   <-- COLLISION' : ''}`);
});
const collisions = Object.entries(seen).filter(([l, n]) => n > 1 && l.startsWith('Exhibit'));
console.log('');
console.log(`COLLISIONS: ${collisions.length ? collisions.map(([l, n]) => `${l}×${n}`).join(', ') : 'none'}`);
