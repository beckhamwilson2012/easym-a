#!/usr/bin/env node
// agent/promote-discovered.mjs — run-sweep.sh calls this at RUN start.
//
// A `## Discovered` entry that already carries a full reproduction is a queue item that nobody filed. It
// sits unworked not because it lacks evidence but because moving it is manual, and QUEUE.md's own rule is
// that an item missing any of pair / observed / expected / source is BLOCKED and must never be invented.
// So: an entry with ALL FOUR, and a `pair:` naming a real TICKER/TICKER deck, is promoted to the BOTTOM of
// Open — bottom, because `## Open`'s order is a hand-maintained upstream-first chain and inserting into the
// middle of it would reorder causes behind their symptoms.
//
// Entries missing a field, or whose `pair:` is a placeholder like "— (none on hand)", are LEFT WHERE THEY
// ARE and reported. That is deliberate: a pair alone is not a repro (CLAUDE.md), and auto-promoting an item
// with no deck to reproduce on would burn an agent turn to return BLOCKED.
//
//   node agent/promote-discovered.mjs [--dry-run] [path/to/QUEUE.md]
// Prints one line per entry considered; exits 0 whether or not anything moved (never fails a run).
import fs from 'node:fs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const QUEUE = args.find((a) => !a.startsWith('--')) || 'agent/QUEUE.md';

const src = fs.readFileSync(QUEUE, 'utf8');
const lines = src.split('\n');

const headingAt = (name) => lines.findIndex((l) => l.trim() === `## ${name}`);
const openAt = headingAt('Open'), closedAt = headingAt('Closed'), discAt = headingAt('Discovered');
if (openAt < 0 || discAt < 0) { console.log('promote: no Open/Discovered headings — nothing to do'); process.exit(0); }

// Entries in Discovered start at column 0 with "- " and run until the next such line or the next heading.
const discEnd = lines.findIndex((l, i) => i > discAt && l.startsWith('## '));
const end = discEnd < 0 ? lines.length : discEnd;
const starts = [];
for (let i = discAt + 1; i < end; i++) if (/^- /.test(lines[i])) starts.push(i);

const entries = starts.map((s, k) => {
  const e = (k + 1 < starts.length ? starts[k + 1] : end);
  let last = e - 1;
  while (last > s && lines[last].trim() === '') last--;        // trim trailing blanks
  return { from: s, to: last, text: lines.slice(s, last + 1).join('\n') };
});

const FIELD = {
  pair:     /(?:^|[(\s·])pair:\s*(.+?)(?:·|$)/ms,
  observed: /(?:^|[(\s·])(?:observed|repro|got):\s*\S/ms,
  expected: /(?:^|[(\s·])(?:expected|want):\s*\S/ms,
  source:   /(?:^|[(\s·])(?:source|root|why):\s*\S/ms,
};
const REAL_PAIR = /\b[A-Z][A-Z0-9.\-]{0,6}\/[A-Z][A-Z0-9.\-]{0,6}\b/;

const title = (t) => (t.match(/^- \*\*(.+?)\*\*/s)?.[1] || t.split('\n')[0].replace(/^- /, '')).replace(/\s+/g, ' ').slice(0, 90);
const promote = [], skip = [];
for (const en of entries) {
  const missing = Object.keys(FIELD).filter((k) => !FIELD[k].test(en.text));
  const pairVal = en.text.match(FIELD.pair)?.[1] || '';
  if (missing.length) { skip.push([en, `missing ${missing.join(', ')}`]); continue; }
  if (!REAL_PAIR.test(pairVal)) { skip.push([en, `pair: names no TICKER/TICKER deck`]); continue; }
  promote.push(en);
}

for (const [en, why] of skip) console.log(`promote: left in Discovered (${why}) — ${title(en.text)}`);

if (!promote.length) { console.log('promote: nothing in Discovered carries a full repro — Open unchanged'); process.exit(0); }

// Rewrite: Open gains each promoted entry at its bottom, as "- [ ] **<title>**" with the body kept verbatim.
const openEnd = (closedAt > openAt ? closedAt : discAt);
let tailBlank = openEnd - 1;
while (tailBlank > openAt && lines[tailBlank].trim() === '') tailBlank--;

const asOpenItem = (en) => {
  const body = en.text.split('\n');
  const head = body[0].replace(/^- (\[.\] )?/, '- [ ] ');
  const note = `      <!-- auto-promoted from Discovered ${new Date().toISOString().slice(0, 10)} by promote-discovered.mjs: carries pair/observed/expected/source. Added at the BOTTOM of Open so the upstream-first order above is untouched. -->`;
  return [head, ...body.slice(1), note].join('\n');
};

const out = [
  ...lines.slice(0, tailBlank + 1),
  ...promote.map(asOpenItem),
  ...lines.slice(tailBlank + 1, discAt),
  ...(() => {
    const keep = new Set(promote.map((p) => p.from));
    const res = [];
    for (let i = discAt; i < (discEnd < 0 ? lines.length : discEnd); i++) {
      const owner = entries.find((e) => i >= e.from && i <= e.to);
      if (owner && keep.has(owner.from)) continue;
      res.push(lines[i]);
    }
    return res;
  })(),
  ...(discEnd < 0 ? [] : lines.slice(discEnd)),
].join('\n');

for (const en of promote) console.log(`promote: Discovered -> Open (bottom) — ${title(en.text)}`);
if (dry) { console.log('promote: --dry-run, QUEUE.md not written'); process.exit(0); }
fs.writeFileSync(QUEUE, out);
console.log(`promote: QUEUE.md rewritten — ${promote.length} item(s) moved`);
