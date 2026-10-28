/** @jest-environment node */
// Executive Summary formatters — the null-honest display contract.
//
// Why this file exists: the slide is registered `showInPdf:false`, so it never appears in the hidden
// PDF tree that tools/noop-ab captures. The byte-diff gate therefore CANNOT see it — a passing gate
// proves nothing was broken elsewhere and nothing whatsoever about this slide. Both zero-coercion
// defects below were caught by rendering the deck by hand and reading it; these are the regression
// tests so the next one isn't found the same way.
//
// The contract: an unavailable input renders "—". Never 0, never "$0.00", never 'N/A'.
const { __fmt } = require('../SectionExecutiveSummary');
const { DASH, num, pos, money, pc, pcS, pcF, sh, ps } = __fmt;
const { fmtMoney, fmtPct, fmtPctSigned, fmtPctFloor, fmtShares } = require('../../shared/deckTokens');

describe('num — parse or null', () => {
  it.each([['12.5', 12.5], [12.5, 12.5], ['0', 0], [0, 0], ['-3', -3]])('%p → %p', (i, o) => {
    expect(num(i)).toBe(o);
  });
  it.each([[null], [undefined], [''], ['abc'], [NaN], ['n/a'], [{}]])('%p → null', (i) => {
    expect(num(i)).toBe(null);
  });
});

describe('pos — ZERO is an un-entered input, not a value', () => {
  // defaultInputs seeds offerPricePerShare and companyAShares at 0. Without this guard a private
  // deal rendered "Offer price / share $0.00" and "Acquirer shares outstanding 0" — both fabricated,
  // and both what deckModel.js:79 refuses in the model layer ("unknown, not 0").
  it.each([[0], ['0'], [-1], ['-250'], [null], [undefined], ['']])('%p → null', (i) => {
    expect(pos(i)).toBe(null);
  });
  it.each([[304.11, 304.11], ['348', 348], [0.0001, 0.0001]])('%p → %p (positive passes through)', (i, o) => {
    expect(pos(i)).toBe(o);
  });
});

describe('the two defects this guard fixed', () => {
  it('a 0 offer price renders "—", not "$0.00"', () => {
    expect(ps(0)).toBe('$0.00');          // ps alone does NOT guard...
    expect(ps(pos(0))).toBe(DASH);        // ...the guard is pos's job, and the slide composes them.
  });

  it('a 0 share count renders "—", not "0"', () => {
    expect(sh(0)).toBe('0');              // fmtShares falls through its scale branches to "0"
    expect(sh(pos(0))).toBe(DASH);
  });

  it('newShares 0 is NOT guarded — an all-cash deal really does issue none', () => {
    expect(sh(0)).toBe('0');
    expect(sh(null)).toBe(DASH);          // unknown still reads "—"
  });
});

describe('every formatter returns the dash for an absent value', () => {
  it.each([
    ['money', money], ['pc', pc], ['pcS', pcS], ['pcF', pcF], ['sh', sh], ['ps', ps],
  ])('%s(null/undefined/"") → "—"', (_name, fn) => {
    expect(fn(null)).toBe(DASH);
    expect(fn(undefined)).toBe(DASH);
    expect(fn('')).toBe(DASH);
    expect(fn('not a number')).toBe(DASH);
  });

  it('the dash is an em dash, matching the rest of the deck', () => {
    expect(DASH).toBe('—');
    expect(DASH).not.toBe('-');
    expect(DASH).not.toBe('N/A');
  });
});

describe('present values delegate to the deck formatters — one scaling convention', () => {
  // Asserted as delegation rather than hardcoded strings: the scaling rules belong to deckTokens,
  // and duplicating its expected output here would just pin a second copy of them.
  it.each([[105500], [5595], [-250], [0.5], [0]])('money(%p) === fmtMoney(%p)', (v) => {
    expect(money(v)).toBe(fmtMoney(v));
  });
  it.each([[30], [0], [-4.5]])('pc(%p) === fmtPct(%p)', (v) => {
    expect(pc(v)).toBe(fmtPct(v));
  });
  it('pc honours its digits argument', () => {
    expect(pc(60, 0)).toBe(fmtPct(60, 0));
  });
  it.each([[12.3], [-12.3], [0]])('pcS(%p) === fmtPctSigned(%p)', (v) => {
    expect(pcS(v)).toBe(fmtPctSigned(v));
  });
  it.each([[29.4], [0.02], [99.99]])('pcF(%p) === fmtPctFloor(%p)', (v) => {
    expect(pcF(v)).toBe(fmtPctFloor(v));
  });
  it.each([[348], [140.6], [2696]])('sh(%p) === fmtShares(%p)', (v) => {
    expect(sh(v)).toBe(fmtShares(v));
  });

  it('ps is 2dp currency', () => {
    expect(ps(304.11)).toBe('$304.11');
    expect(ps('304.1')).toBe('$304.10');
    expect(ps(233.925)).toBe('$233.93');
  });

  it('never leaks the deck formatters’ "N/A" for a null — that string means something else here', () => {
    [money, pc, pcS, pcF, sh, ps].forEach(fn => expect(fn(null)).not.toBe('N/A'));
    expect(fmtMoney(null)).toBe('N/A');   // the delegate's own null answer, which we deliberately replace
  });
});
