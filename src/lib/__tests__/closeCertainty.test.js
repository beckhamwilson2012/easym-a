/** @jest-environment node */
// Certainty-of-close tests — the THREE-STATE contract.
//
// The defect these guard against is Pattern B: collapsing "the test does not trip" and "we lack the
// inputs to evaluate it" into one answer. The deck already shipped that bug once in this exact
// area — SectionDashboard.js:66-73 pushes no 19.9% flag at all when the share count is null, because
// triggers199Rule(null) returns `false`, so an unknown denominator is indistinguishable from "no
// vote required". Shares outstanding CAN be null (the server share resolver falls through to null
// when every source is stale, absent or non-positive, and deckModel.js:79 preserves that null).
//
// So every test here returns { state, reason } with state ∈ met | not-met | unknown, and the
// most important assertion in the file is the table at the bottom: absent inputs yield UNKNOWN,
// never NOT_MET.
const {
  MET, NOT_MET, UNKNOWN,
  issuancePct, acquirerVoteTest, majorityStockTest,
  hsrSizeOfTransactionTest, sameSicTest, financingTest,
  HSR_SIZE_OF_TRANSACTION_USD_M, HSR_THRESHOLD_EFFECTIVE,
} = require('../closeCertainty');
const { ISSUANCE_VOTE_THRESHOLD, ISSUANCE_MAJORITY_THRESHOLD } = require('../premiumThresholds');

describe('issuancePct — null-honest, never a coerced zero', () => {
  it('computes issuance as a % of PRE-DEAL shares (NET/DDOG shape: 140.6 of 348)', () => {
    expect(issuancePct({ newShares: 140.6, preDealShares: 348 })).toBeCloseTo(40.4, 1);
  });

  it('parses numeric strings (dealCalc hands several figures back as fixed-precision strings)', () => {
    expect(issuancePct({ newShares: '140.6', preDealShares: '348' })).toBeCloseTo(40.4, 1);
  });

  it.each([
    ['null newShares',        { newShares: null, preDealShares: 348 }],
    ['null preDealShares',    { newShares: 140.6, preDealShares: null }],
    ['undefined both',        {}],
    ['non-numeric',           { newShares: 'n/a', preDealShares: 348 }],
  ])('%s → null', (_label, args) => {
    expect(issuancePct(args)).toBe(null);
  });

  it.each([[0], [-5]])('preDealShares %p → null, NOT a division result', (p) => {
    // defaultInputs seeds companyAShares at 0, so this is the live path, not a hypothetical.
    expect(issuancePct({ newShares: 140.6, preDealShares: p })).toBe(null);
  });

  it('newShares 0 is a REAL answer (all-cash deal issues none) → 0%, not null', () => {
    expect(issuancePct({ newShares: 0, preDealShares: 348 })).toBe(0);
  });
});

describe('acquirerVoteTest — NYSE §312.03 / Nasdaq 5635', () => {
  it('above the threshold → met', () => {
    expect(acquirerVoteTest(40.4, ISSUANCE_VOTE_THRESHOLD).state).toBe(MET);
  });
  it('below the threshold → not-met', () => {
    expect(acquirerVoteTest(10, ISSUANCE_VOTE_THRESHOLD).state).toBe(NOT_MET);
  });
  it('exactly at the threshold → met (the rule is >=)', () => {
    expect(acquirerVoteTest(ISSUANCE_VOTE_THRESHOLD, ISSUANCE_VOTE_THRESHOLD).state).toBe(MET);
  });
  it('a hair under the threshold → not-met', () => {
    expect(acquirerVoteTest(ISSUANCE_VOTE_THRESHOLD - 0.01, ISSUANCE_VOTE_THRESHOLD).state).toBe(NOT_MET);
  });
  it('null pct → unknown WITH a reason — never "not required"', () => {
    const r = acquirerVoteTest(null, ISSUANCE_VOTE_THRESHOLD);
    expect(r.state).toBe(UNKNOWN);
    expect(r.state).not.toBe(NOT_MET);
    expect(r.reason).toMatch(/unavailable/i);
  });
});

describe('majorityStockTest', () => {
  it.each([
    [ISSUANCE_MAJORITY_THRESHOLD, MET],
    [ISSUANCE_MAJORITY_THRESHOLD + 10, MET],
    [ISSUANCE_MAJORITY_THRESHOLD - 0.1, NOT_MET],
  ])('pct %p → %s', (pct, state) => {
    expect(majorityStockTest(pct, ISSUANCE_MAJORITY_THRESHOLD).state).toBe(state);
  });
  it('null pct → unknown', () => {
    expect(majorityStockTest(null, ISSUANCE_MAJORITY_THRESHOLD).state).toBe(UNKNOWN);
  });
});

describe('hsrSizeOfTransactionTest — on EQUITY value, and unevaluable until configured', () => {
  it('ships with no threshold, so even a $105B deal is unknown — not "met"', () => {
    // The FTC revises the threshold annually; a value hardcoded from memory goes stale on a known
    // schedule and a wrong one is worse than none. Unconfigured must therefore read "—".
    expect(HSR_SIZE_OF_TRANSACTION_USD_M).toBe(null);
    const r = hsrSizeOfTransactionTest(105500);
    expect(r.state).toBe(UNKNOWN);
    expect(r.reason).toMatch(/not configured/i);
  });

  it('a threshold is never set without its effective date', () => {
    // Invariant, not a snapshot: this keeps passing once someone sets the threshold, and fails if
    // they set it without citing the notice it came from.
    if (HSR_SIZE_OF_TRANSACTION_USD_M != null) expect(HSR_THRESHOLD_EFFECTIVE).toBeTruthy();
  });

  it.each([
    ['above',      105500, 126.4, MET],
    ['exactly at', 126.4,  126.4, MET],
    ['below',      100,    126.4, NOT_MET],
  ])('%s threshold → %s', (_l, value, threshold, state) => {
    expect(hsrSizeOfTransactionTest(value, threshold).state).toBe(state);
  });

  it('null equity value with a threshold set → unknown', () => {
    expect(hsrSizeOfTransactionTest(null, 126.4).state).toBe(UNKNOWN);
  });
});

describe('sameSicTest — a classification match, not an antitrust conclusion', () => {
  it('NET/DDOG are both 7372 → met', () => {
    expect(sameSicTest('7372', '7372').state).toBe(MET);
  });
  it('compares as strings, so a number and its string agree', () => {
    expect(sameSicTest(7372, '7372').state).toBe(MET);
  });
  it('different SICs → not-met', () => {
    expect(sameSicTest('7372', '6021').state).toBe(NOT_MET);
  });
  it.each([[null, '7372'], ['7372', null], [null, null], ['', '7372']])(
    'missing SIC (%p, %p) → unknown, never "no overlap"', (a, b) => {
      const r = sameSicTest(a, b);
      expect(r.state).toBe(UNKNOWN);
      expect(r.state).not.toBe(NOT_MET);
    });
});

describe('financingTest', () => {
  it('positive new debt → met', () => {
    expect(financingTest('54300').state).toBe(MET);
  });
  it.each([[0], ['0']])('zero new debt %p → not-met (a real answer: funded from cash and stock)', (v) => {
    expect(financingTest(v).state).toBe(NOT_MET);
  });
  it('null → unknown', () => {
    expect(financingTest(null).state).toBe(UNKNOWN);
  });
});

// ── The contract itself ──────────────────────────────────────────────────────
describe('every test is three-state: absent inputs → unknown, never not-met', () => {
  it.each([
    ['acquirerVoteTest',        () => acquirerVoteTest(null, ISSUANCE_VOTE_THRESHOLD)],
    ['majorityStockTest',       () => majorityStockTest(null, ISSUANCE_MAJORITY_THRESHOLD)],
    ['hsrSizeOfTransactionTest',() => hsrSizeOfTransactionTest(null, 126.4)],
    ['sameSicTest',             () => sameSicTest(null, null)],
    ['financingTest',           () => financingTest(null)],
  ])('%s', (_name, call) => {
    const r = call();
    expect(r.state).toBe(UNKNOWN);
    expect(r.state).not.toBe(NOT_MET);
    expect(typeof r).toBe('object');          // never a bare boolean
    expect(typeof r.reason).toBe('string');   // and always says WHY it could not be evaluated
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('a populated deal evaluates every test to a decided state', () => {
    const pct = issuancePct({ newShares: 140.6, preDealShares: 348 });
    const states = [
      acquirerVoteTest(pct, ISSUANCE_VOTE_THRESHOLD),
      majorityStockTest(pct, ISSUANCE_MAJORITY_THRESHOLD),
      hsrSizeOfTransactionTest(105500, 126.4),
      sameSicTest('7372', '7372'),
      financingTest('54300'),
    ].map(r => r.state);
    expect(states).not.toContain(UNKNOWN);
    states.forEach(s => expect([MET, NOT_MET]).toContain(s));
  });
});
