// ─────────────────────────────────────────────────────────────────────────────
// Shared UI driver for the no-op A/B harness.
//
// record.js and run.js MUST drive the app identically — if they diverged, the recorded fixture would
// not match the requests replay issues, and the gate would fail on a harness bug rather than a code
// change. So the whole flow lives here once, and is DATA-driven from the input fixture's `flow`
// block (deal-type button, optional ticker pickers, run button, final section). A future entry-flow
// change is then a fixture edit, not a code edit — the failure mode that left this harness dead for
// two months after d1bfd2d (2026-08-20) removed the "Manual Entry" button it was hardcoded against.
// ─────────────────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// React controlled inputs ignore a plain .value assignment — go through the prototype setter and
// dispatch a bubbling 'input' so React's onChange runs.
const setF = (page, name, val) => page.evaluate((n, v) => {
  const el = document.querySelector(`input[name="${n}"]`);
  if (!el) return false;
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, name, val);

const clickText = (page, re) => page.evaluate((r) => {
  const btn = [...document.querySelectorAll('button')].find(x => new RegExp(r).test(x.textContent) && !x.disabled);
  if (!btn) return false;
  btn.click();
  return true;
}, re);

// react-select: focus the Nth control, type the symbol, then click the option whose label STARTS
// with that exact symbol. Clicking the exact option (rather than pressing Enter on whatever is
// highlighted) keeps the choice deterministic even if the search ranking ever moves.
async function pickTicker(page, index, symbol) {
  const controls = await page.$$('[class*="-control"]');
  if (!controls[index]) throw new Error(`ticker select #${index} not found`);
  await controls[index].click();
  await sleep(250);
  // Set the whole query in ONE assignment. Typing keystroke by keystroke lets react-select's
  // debounce decide how many prefix queries fire, and that count varies with timing between runs —
  // a non-deterministic request set, which the recorded fixture cannot tolerate. One assignment
  // fires exactly one /search?q=<symbol>.
  const typed = await page.evaluate((i, sym) => {
    const el = document.querySelectorAll('input[role="combobox"]')[i];
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, sym);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, index, symbol);
  if (!typed) throw new Error(`ticker input #${index} not found`);
  await page.waitForFunction(
    (sym) => [...document.querySelectorAll('[id*="option"]')].some(e => e.textContent.trim().startsWith(sym + ' ')),
    { timeout: 30000 }, symbol);
  const ok = await page.evaluate((sym) => {
    const opt = [...document.querySelectorAll('[id*="option"]')].find(e => e.textContent.trim().startsWith(sym + ' '));
    if (!opt) return false;
    opt.click();
    return true;
  }, symbol);
  if (!ok) throw new Error(`no option for ${symbol}`);
}

async function driveFlow(page, spec, opts = {}) {
  const flow = spec.flow || {};
  const settle = opts.settleMs ?? 2500;

  // 1 — deal type.
  const dealBtn = flow.dealTypeButton || 'Neither is listed';
  await page.waitForFunction(
    (r) => [...document.querySelectorAll('button')].some(x => new RegExp(r).test(x.textContent)),
    { timeout: 30000 }, dealBtn);
  if (!await clickText(page, dealBtn)) throw new Error(`deal-type button not clickable: ${dealBtn}`);
  await sleep(1500);

  // 2 — ticker pickers (public sides only; absent on the manual fixture).
  for (const t of (flow.tickerSelects || [])) {
    await pickTicker(page, t.index, t.symbol);
    // The selection kicks off that side's fetch chain; give it room to finish before the next one so
    // the recorded request set is stable.
    await sleep(t.settleMs ?? 9000);
  }

  // 3 — inputs, in TWO PASSES: the deal fields (offer, fees, synergies) render only once the
  // company data is in place, so one pass reports them missing and silently runs different
  // effective inputs — the confound the 11-C trap note warns about.
  if (flow.firstInput) await page.waitForSelector(`input[name="${flow.firstInput}"]`, { timeout: 30000 });
  const entries = Object.entries(spec.formInputs || {});
  let missing = [];
  for (let pass = 1; pass <= 2; pass++) {
    const todo = pass === 1 ? entries : entries.filter(([n]) => missing.includes(n));
    missing = [];
    for (const [name, val] of todo) if (!await setF(page, name, val)) missing.push(name);
    await sleep(900);
    if (!missing.length) break;
  }

  // 4 — build.
  const runBtn = flow.runButton || 'Run Analysis';
  await page.waitForFunction(
    (r) => [...document.querySelectorAll('button')].some(x => new RegExp(r).test(x.textContent) && !x.disabled),
    { timeout: 30000 }, runBtn);
  if (!await clickText(page, runBtn)) throw new Error(`run button not clickable: ${runBtn}`);
  await page.waitForSelector(`[data-section-id="${flow.finalSection || 'verification2'}"]`, { timeout: 60000 });
  await sleep(settle);

  return { missingInputs: missing };
}

module.exports = { driveFlow, setF, clickText, pickTicker, sleep };
