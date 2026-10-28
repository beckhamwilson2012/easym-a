// Standing no-op harness — deterministic deck capture.
//
// The gate's premise: identical inputs produce an identical deck, so a byte diff isolates CODE from
// DATA. Two fixtures satisfy that premise two different ways:
//
//   STAGE_11F_PUBLIC_NOOP_INPUTS.json   public deck, 17 sections — ticker flow, every same-origin
//                                       response REPLAYED from a recorded fixture (tools/noop-ab/
//                                       stub.js). Default.
//   STAGE_11E_PRIVATE_NOOP_INPUTS.json  private deck, 16 sections — manual entry, no network at all.
//
// Together they cover all 20 registered sections: the private path suppresses equity / analyst /
// exchangeratio, and the public path never renders privatevaluation / creditstats. Run both.
//
// The flow itself is DATA (the fixture's `flow` block) and lives in flow.js, shared with record.js
// so the recorder and the gate drive the app identically. That is deliberate: this harness sat dead
// for ~2 months because its flow was hardcoded against a "Manual Entry" button that d1bfd2d
// (2026-08-20) removed, and nothing failed loudly enough to notice.
//
// Guards, all of which FAIL the run rather than warn:
//   - any input the DOM never exposed  → the two trees would see different effective inputs
//   - a captured section count ≠ the fixture's  → wrong deck shape, diff would be vacuous
//   - any stub miss  → the fixture is incomplete; without this it would fall through to the live
//     network and silently reintroduce the market drift the gate exists to eliminate
//
// env OUT    = output json path (default /tmp/noop_out.json)
// env INPUTS = input-set json path (default ../../STAGE_11F_PUBLIC_NOOP_INPUTS.json)
// env BASE_URL = app origin (default http://localhost:3001)
const path = require('path');
const fs = require('fs');
const APP_ROOT = path.resolve(__dirname, '..', '..');
const puppeteer = require(path.join(APP_ROOT, 'node_modules', 'puppeteer-core'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { attachReplayer } = require('./stub');
const { driveFlow } = require('./flow');

const OUT = process.env.OUT || '/tmp/noop_out.json';
const INPUTS = process.env.INPUTS || path.join(APP_ROOT, 'STAGE_11F_PUBLIC_NOOP_INPUTS.json');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const spec = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const cErr = [], pErr = [];
  page.on('console', m => { if (m.type() === 'error') cErr.push(m.text()); });
  page.on('pageerror', e => pErr.push(e.message));

  // Replay the recorded network when the fixture names one; the manual fixture names none and makes
  // no requests at all.
  const misses = [];
  if (spec.flow && spec.flow.stubFile) {
    const stubPath = path.join(APP_ROOT, spec.flow.stubFile);
    if (!fs.existsSync(stubPath)) throw new Error(`stub fixture missing: ${spec.flow.stubFile} — run: node tools/noop-ab/record.js`);
    const { responses } = JSON.parse(fs.readFileSync(stubPath, 'utf8'));
    await attachReplayer(page, responses, misses);
  }

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const { missingInputs } = await driveFlow(page, spec);

  const out = await page.evaluate(() => {
    const secs = {};
    document.querySelectorAll('[data-section-id]').forEach(el => secs[el.getAttribute('data-section-id')] = el.innerText);
    const body = document.body.innerText;
    return { secs, hasNaN: /NaN/.test(body), hasUndef: /undefined/.test(body) };
  });

  const result = {
    label: process.env.RUN_LABEL || null,
    inputs: path.basename(INPUTS),
    sectionCount: Object.keys(out.secs).length,
    missingInputs,
    stubMisses: [...new Set(misses)],
    hasNaN: out.hasNaN,
    hasUndef: out.hasUndef,
    cErr, pErr,
    sections: out.secs,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`[${result.label}] ${result.inputs} -> ${OUT} | sections=${result.sectionCount} | missing=[${missingInputs.join(',')}] | stubMisses=${result.stubMisses.length} | cErr=${cErr.length} pErr=${pErr.length} | NaN=${out.hasNaN} undef=${out.hasUndef}`);

  if (missingInputs.length) throw new Error(`inputs the DOM never exposed: ${missingInputs.join(',')} — fixture is stale against the current form`);
  if (result.stubMisses.length) throw new Error(`stub misses (fixture incomplete, would have hit the live network): ${result.stubMisses.join(', ')} — re-record: node tools/noop-ab/record.js`);
  if (spec.flow && spec.flow.expectedSections && result.sectionCount !== spec.flow.expectedSections)
    throw new Error(`captured ${result.sectionCount} sections, fixture expects ${spec.flow.expectedSections} — wrong deck shape`);

  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
