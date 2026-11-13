// Grader tests — honest blanks (Fix 7A/7B/10) and the planted-defect guard.
//   node tools/sweep-analyzer/test/grader.test.js        (no network; exit 0 = all pass)
//
// Fixtures are four real decks captured at 9a001a7 on 2026-11-12 (capture.js variants). Every planted test
// edits a COPY in a temp dir; the fixtures themselves are never modified.
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const HB = require('../honestBlank');
const SD = require('../../snapshot-diff');
const CAP = require('../capture');

const FX = path.join(__dirname, 'fixtures');
const ANALYZE = path.join(__dirname, '..', 'analyze.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-test-'));
const load = f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));
let n = 0, failed = 0;
const t = (name, fn) => { n++; try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message.split('\n')[0]); } };

// run the real analyzer on records (written to temp files) → { flags, exp }
let runN = 0;
function grade(recs) {
  const dir = path.join(TMP, 'run' + (++runN)); fs.mkdirSync(dir);
  const files = recs.map((r, i) => { const f = path.join(dir, `r${i}.json`); fs.writeFileSync(f, JSON.stringify(r)); return f; });
  execFileSync(process.execPath, [ANALYZE, ...files], { stdio: 'ignore', env: { ...process.env, OUT: path.join(dir, 'f.md'), FLAGS: path.join(dir, 'flags.json'), EXPECTED: path.join(dir, 'exp.json') } });
  return { flags: JSON.parse(fs.readFileSync(path.join(dir, 'flags.json'))), exp: JSON.parse(fs.readFileSync(path.join(dir, 'exp.json'))) };
}
const edit = (rec, sec, from, to) => { const r = JSON.parse(JSON.stringify(rec)); const tgt = sec === 'body' ? 'bodyText' : null;
  if (tgt) { assert(r.bodyText.includes(from), `fixture lacks "${from.slice(0, 40)}" in body`); r.bodyText = r.bodyText.split(from).join(to); }
  else { assert(r.sections[sec].includes(from), `fixture lacks "${from.slice(0, 40)}" in ${sec}`); r.sections[sec] = r.sections[sec].split(from).join(to); }
  return r; };

// ── 1. reason detection (unit) ────────────────────────────────────────────────────────────────────────
const NOTE = 'split.n No consensus available: FMP publishes no forward gross profit, so forward cost of revenue, gross profit and gross margin are "—". Forward Operating Expense is "—" — consensus supplies operating income but not gross profit, so a derived figure would mix bases.';
t('reason: footnote marker on the label', () => assert.match(HB.reasonFor('—', 'Gross Profit n', NOTE), /No consensus available/));
t('reason: row is the subject of a blank sentence', () => assert.match(HB.reasonFor('—', 'Operating Expense', NOTE), /Operating Expense is "—"/));
t('reason: a sentence blanking ANOTHER row is not this row\'s reason', () => assert.strictEqual(HB.reasonFor('—', 'Gross Profit', 'Forward Operating Expense is "—" — consensus supplies operating income but not gross profit, so a derived figure would mix.'), null));
t('reason: inline in the cell', () => assert.strictEqual(HB.reasonFor('— (companies on different bases)', 'Combined EBITDA', ''), 'companies on different bases'));
t('reason: inline in the row label', () => assert.match(HB.reasonFor('—', 'Year 2 FY2026e — consensus is non-GAAP; no GAAP forecast', ''), /consensus is non-GAAP/));
t('reason: general n/m rule', () => assert.ok(HB.reasonFor('n/m', 'EV / Revenue', 'Every multiple is n/m when its denominator is zero or negative, or when it is above 100x.')));
t('reason: an n/m rule for a DIFFERENT metric does not count', () => assert.strictEqual(HB.reasonFor('n/m', 'EV / EBITDA (LTM)', 'P/E is n/m where earnings are near zero (ratio > 100).'), null));
t('reason: footnote glued to the cell ("n/mᵇ")', () => assert.ok(HB.reasonFor('n/mᵇ', 'EV / EBITDA (LTM)', 'x). ᵇ EV/EBITDA is n/mᵇ where D&A is not reported under a combined concept, so LTM EBITDA cannot be computed.')));
t('reason: a table row is never its own reason', () => assert.strictEqual(HB.reasonFor('n/m', 'EV / EBITDA (LTM)', 'EV / EBITDA (LTM)\tn/m\tn/m\t41.1x'), null));
t('reason: a footnote that explains an ESTIMATE, not a blank, does not count', () => assert.strictEqual(HB.reasonFor('—', 'Gross Profit e', 'x.e Gross profit forward = most-recent actual gross margin held × consensus revenue (est.).'), null));
t('reason: prose "not available" about a BASIS does not explain a cell', () => assert.strictEqual(HB.reasonFor('—', 'Operating Income', 'Non-GAAP figures were not available/reconciled for this filer, so operating income, net income, EPS and their margins are shown on a GAAP basis (labeled).'), null));
t('reason: bare "—" with nothing on screen → null', () => assert.strictEqual(HB.reasonFor('—', 'Net Income', 'Source: SEC EDGAR.'), null));
t('reason: a value is never a blank', () => assert.strictEqual(HB.reasonFor('$1,692', 'Gross Profit n', NOTE), null));
t('normMinus: U+2212 → "-"', () => assert.strictEqual(HB.normMinus('−$0.36'), '-$0.36'));

// ── 2. fresh decks grade clean; each honest blank is recorded with its reason ───────────────────────────
const FIX = ['HNGE_TDOC+ltm-gaap.json', 'NET_DDOG+nongaap.json', 'HNGE_OMDA+nongaap.json', 'KO_PEP+gaap.json'].map(load);
const base = grade(FIX);
t('fresh 9a001a7 decks: 0 flags', () => assert.deepStrictEqual(base.flags.map(f => f.pair + ' ' + f.what), []));
t('§8 target gross profit "—" recorded EXPECTED with the deck\'s footnote', () => assert.ok(base.exp.some(e => e.pair === 'KO/PEP+gaap' && e.field === 'gross profit (target)' && /No consensus available/.test(e.reason))));
t('HNGE/OMDA Non-GAAP combined EBITDA "—" recorded EXPECTED with "companies on different bases"', () => assert.ok(base.exp.some(e => e.pair === 'HNGE/OMDA+nongaap' && /different bases/.test(e.reason))));
t('negative pro forma EPS read with its sign (−$0.36, stated 85.0M shares) and ties', () => { const md = fs.readFileSync(path.join(TMP, 'run1', 'f.md'), 'utf8'); assert.match(md, /12\. Pro forma EPS \(PFNI÷PFsh\): inputs PF NI \$-33M ÷ PF shares 92 \(stated 85\+new 7\) · mine -0\.36 · rendered -0\.36/); });
t('LTM cards: combined EBITDA recomputed on LTM (156 + 206 = $362M)', () => { const md = fs.readFileSync(path.join(TMP, 'run1', 'f.md'), 'utf8'); assert.match(md, /10\. Combined EBITDA \(A\+B\+synY1\): inputs LTM A \$156M \+ B \$206M .* rendered \$362M · Δ 0\.00%/); });

// ── 3. planted defects are still caught ────────────────────────────────────────────────────────────────
const [HT, ND, HO, KP] = FIX;
t('PLANT number: §2 target EV 62,352 → 72,352 (no reason) → WRONG flag', () => {
  const g = grade([edit(ND, 'comparables', '113,461\t62,352\t', '113,461\t72,352\t')]);
  assert.ok(g.flags.some(f => f.kind === 'WRONG' && /Current EV \(target §2\)/.test(f.what)), JSON.stringify(g.flags.map(f => f.what)));
});
t('PLANT number: pro forma EPS −$1.25 → −$1.55 → WRONG flag', () => {
  const g = grade([edit(ND, 'body', 'Pro Forma EPS\nⓘ\n−$1.25', 'Pro Forma EPS\nⓘ\n−$1.55')]);
  assert.ok(g.flags.some(f => /Pro forma EPS/.test(f.what)), JSON.stringify(g.flags.map(f => f.what)));
});
t('PLANT reason removed: §8 gross-profit footnote deleted → cross-surface flag returns', () => {
  const r = edit(KP, 'proforma', 'n No consensus available: FMP publishes no forward gross profit, so forward cost of revenue, gross profit and gross margin are "—".', '');
  const g = grade([r]);
  assert.ok(g.flags.some(f => f.root === 'A-crossSurface' && /gross profit \(target\)/.test(f.what)), JSON.stringify(g.flags.map(f => f.what)));
});
t('PLANT reason removed: "— (companies on different bases)" → "—" and its sentences deleted → MISSING flag', () => {
  let r = edit(HO, 'body', '— (companies on different bases)', '—');
  r = edit(r, 'body', 'Combined EBITDA and the leverage ratios on it are “—”: companies on different bases.', '');
  const g = grade([r]);
  assert.ok(g.flags.some(f => f.kind === 'MISSING' && /Combined EBITDA/.test(f.what)), JSON.stringify(g.flags.map(f => f.what)));
});
t('PLANT reason removed: n/m rule deleted from §2 → bare n/m flagged', () => {
  let r = JSON.parse(JSON.stringify(ND));
  r.sections.comparables = r.sections.comparables.split('\n').filter(l => !/n\/m (when|where)/.test(l) || l.includes('\t')).join('\n');
  r.sections.comparables = r.sections.comparables.replace(/[^.\n]*\bn\/m[ᵃ-ᶻ]?\s+(?:when|where)[^.\n]*\.?/g, '');
  const g = grade([r]);
  assert.ok(g.flags.some(f => /EV\/EBITDA \(target §2\).*no reason on screen/.test(f.what)), JSON.stringify(g.flags.map(f => f.what)));
});

// ── 4. snapshot-diff: honest blank vs dropped figure vs deleted reason ──────────────────────────────────
const sdRows = (txt) => txt;
t('snapshot-diff: value → "—" WITH reason (row label) is not flagged', () => {
  const r = SD.diffSection('x', 'Year 2 FY2026e\t$1.21', 'Year 2 FY2026e — consensus is non-GAAP; no GAAP forecast\t—', []);
  const c = r.cellChanges.find(x => x.old === '$1.21'); assert.strictEqual(c.type, 'POPULATED_TO_HONEST_BLANK'); assert.strictEqual(c.flag, false);
});
t('snapshot-diff: value → "—" with NO reason stays flagged', () => {
  const r = SD.diffSection('x', 'Net Income\t$1.21', 'Net Income\t—', []);
  const c = r.cellChanges[0]; assert.strictEqual(c.type, 'POPULATED_TO_BLANK'); assert.strictEqual(c.flag, true);
});
t('snapshot-diff: value → n/m under a printed n/m rule is not flagged', () => {
  const r = SD.diffSection('x', 'EV / EBITDA (LTM)\t12.1x\t8.2x', 'EV / EBITDA (LTM)\t12.1x\tn/m\nEvery multiple is n/m when its denominator is zero or negative, or when it is above 100x.', []);
  const c = r.cellChanges.find(x => x.old === '8.2x'); assert.strictEqual(c.flag, false);
});
t('snapshot-diff: "— (reason)" → "—" (reason deleted) is flagged', () => {
  const r = SD.diffSection('x', 'Combined EBITDA\t— (companies on different bases)', 'Combined EBITDA\t—', []);
  const c = r.cellChanges[0]; assert.strictEqual(c.type, 'BLANK_REASON_REMOVED'); assert.strictEqual(c.flag, true);
});
t('snapshot-diff: a number that changed is still reported as CHANGED', () => {
  const r = SD.diffSection('x', 'Revenue\t$1,692', 'Revenue\t$1,792', []); assert.strictEqual(r.cellChanges[0].type, 'CHANGED');
});
t('snapshot-diff: "$0" from "—" is still DASH_TO_ZERO (flagged)', () => {
  const r = SD.diffSection('x', 'Debt\t—', 'Debt\t$0', []); assert.strictEqual(r.cellChanges[0].type, 'DASH_TO_ZERO'); assert.strictEqual(r.cellChanges[0].flag, true);
});

// ── 5. capture variant ids ──────────────────────────────────────────────────────────────────────────────
t('capture: plain pair id and file are unchanged', () => { assert.strictEqual(CAP.pairId('KO', 'PEP'), 'KO/PEP'); assert.match(CAP.pairFile('KO', 'PEP'), /\/KO_PEP\.json$/); });
t('capture: variant pair id and file', () => { assert.strictEqual(CAP.pairId('HNGE', 'TDOC', { mode: 'ltm', basis: 'gaap' }), 'HNGE/TDOC+ltm-gaap'); assert.match(CAP.pairFile('HNGE', 'OMDA', { basis: 'nongaap' }), /\/HNGE_OMDA\+nongaap\.json$/); });

console.log(`\n${n - failed}/${n} passed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
