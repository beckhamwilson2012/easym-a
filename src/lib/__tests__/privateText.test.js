// Fix 7b Task 4 — private-deck text a CFO saw: headline, P/E reason, verdict reason, "nullM" new shares.
import { calculate, calcProFormaEPS, buildNarrative, newSharesLabel } from '../../utils/dealCalc';
import { dealVerdict } from '../dealVerdict';

// HNGE on LTM acquiring a private tuck-in: revenue 50, EBITDA 5, NI 2, cash 10, debt 0, $300M, 100% cash. The private
// panel leaves companyBShares and companyBEPS at their defaults (0), as App.js does.
const tuckin = {
  companyARevenue: 801, companyALtmRevenue: 801, companyAEBITDA: 156, companyANetIncome: 166.261, companyACash: 211.553, companyASti: 83.102,
  companyADebt: null, companyAEPS: 1.95, companyADilutedShares: 85.073, companyAShares: 81.271302, currentSharePriceA: 121,
  companyBRevenue: 50, companyBEBITDA: 5, companyBNetIncome: 2, companyBCash: 10, companyBDebt: 0, companyBLtmRevenue: null,
  companyBShares: 0, companyBEPS: 0, offerPricePerShare: 0, offerValueTotal: 300, cashPercent: 100, applySourcesOfFunds: true,
};
const fixture = {
  companyARevenue: 50000, companyAEBITDA: 15000, companyANetIncome: 10000, companyACash: 5000, companyADebt: 2000,
  companyBRevenue: 10000, companyBEBITDA: 3000, companyBNetIncome: 2000, companyBCash: 1000, companyBDebt: 500,
  companyBShares: 0, companyBEPS: 0, offerPricePerShare: 0, offerValueTotal: 90000, cashPercent: 60,
  synergiesY1: 600, synergiesY2: 960, synergiesY3: 1320, applySourcesOfFunds: true,
};

describe('headline', () => {
  test('a private target: "for $300M", no per-share price, the deck name', () => {
    const r = calculate(tuckin);
    const t = buildNarrative(r, tuckin, 'Hinge Health, Inc.', 'Target Company', []);
    expect(t.startsWith("Hinge Health, Inc.'s acquisition of Target Company for $300M ")).toBe(true);
    expect(t).not.toMatch(/\$0\.00|\/share|Company B|total\)/);
  });
  test('the private fixture: "for $90.0B"', () => {
    const r = calculate(fixture);
    expect(buildNarrative(r, fixture, 'Acquirer', 'Target Company', [])).toBe("Acquirer's acquisition of Target Company for $90.0B.");
  });
  test('a public target is unchanged', () => {
    const t = buildNarrative({ totalPurchasePrice: 1149, companyAEPS: 1.98, proFormaEPS: null }, { offerPricePerShare: 19.81 }, 'A', 'B', []);
    expect(t).toBe("A's acquisition of B at $19.81/share ($1.1B total).");
  });
});

describe('P/E', () => {
  test('a profitable private target gets its multiple on totals: 300 ÷ 2 = 150.0x', () => {
    const r = calculate(tuckin);
    expect(r.peRatio).toBe('150.0');
    expect(r.peReason).toBeNull();
    expect(r.peBasis).toBe('equity value ÷ net income');
  });
  test('the fixture: 90,000 ÷ 2,000 = 45.0x', () => {
    expect(calculate(fixture).peRatio).toBe('45.0');
  });
  test('the real reason when it is n/m', () => {
    expect(calculate({ ...tuckin, companyBNetIncome: -2 }).peReason).toBe('Target earnings are negative');
    expect(calculate({ ...tuckin, companyBNetIncome: 0 }).peReason).toBe('Target earnings are zero');
    expect(calculate({ ...tuckin, companyBNetIncome: null }).peReason).toBe('Target net income not available');
  });
  test('public target: negative EPS keeps its text; a missing EPS is "not available", not "negative"', () => {
    const pub = { ...tuckin, offerValueTotal: 0, companyBShares: 100, offerPricePerShare: 10, currentSharePriceB: 8 };
    expect(calculate({ ...pub, companyBEPS: -0.86 }).peReason).toBe('Target earnings are negative');
    expect(calculate({ ...pub, companyBEPS: null }).peReason).toBe('not available');
    expect(calculate({ ...pub, companyBEPS: 0.5 }).peRatio).toBe('20.0');
    expect(calculate({ ...pub, companyBEPS: 0.5 }).peBasis).toBeNull();
  });
});

describe('verdict reason', () => {
  const deal = (inp) => ({ _inputs: inp, _results: calculate(inp), offerPrice: 0, synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
    synergies: { years: [1, 2, 3].map((y) => ({ year: y, ebitda: 0, entered: false })) } });
  const hngeFwd = [{ label: 'FY2026E', fy: 2026, eps: 2.52 }, { label: 'FY2027E', fy: 2027, eps: 3.13 }];

  test('Year 1 pro forma EPS now computes for a private target (it was null on companyBShares === 0)', () => {
    const pf = calcProFormaEPS(0, 0, tuckin);
    expect(pf).not.toBeNull();
    expect(pf.toFixed(2)).toBe(calculate(tuckin).proFormaEPS);    // the EPS helper mirrors calculate() again
  });

  test('HNGE on LTM: step 1 runs, so the verdict computes; no "no forecast EPS for HNGE"', () => {
    const v = dealVerdict({ deal: deal(tuckin), model: { derived: {}, verifiedData: { acquirer: {} } }, acquirerFwd: hngeFwd, targetFwd: [], acquirerName: 'HNGE', targetName: 'Target Company' });
    expect(v.step).toBe(1);
    expect(v.verdict).toBe('accretive');
    // (166.261 + 2 − new-debt drag) ÷ 85.073 vs 1.95
    const r = calculate(tuckin);
    expect(v.proFormaEPS).toBeCloseTo((166.261 + 2 - r.newInterestAfterTax) / 85.073, 12);
  });

  test('HNGE on FY (EPS −7.77): the step-2 reason names the private target, not HNGE', () => {
    const fy = { ...tuckin, companyANetIncome: -424.087, companyAEPS: -7.77, companyADilutedShares: 54.577 };
    const v = dealVerdict({ deal: deal(fy), model: { derived: {}, verifiedData: { acquirer: {} } }, acquirerFwd: hngeFwd, targetFwd: [], acquirerName: 'HNGE', targetName: 'Target Company' });
    expect(v.step).toBeNull();
    expect(v.line).toMatch(/Target Company has no forecast EPS \(a private company has no analyst consensus\)/);
    expect(v.line).not.toMatch(/no forecast EPS for HNGE/);
  });

  test('an acquirer with no forecast at all still says so', () => {
    const fy = { ...tuckin, companyANetIncome: -424.087, companyAEPS: -7.77 };
    const v = dealVerdict({ deal: deal(fy), model: { derived: {}, verifiedData: { acquirer: {} } }, acquirerFwd: [], targetFwd: [], acquirerName: 'HNGE', targetName: 'Target Company' });
    expect(v.line).toMatch(/no forecast EPS for HNGE/);
  });
});

describe('New Shares Issued', () => {
  test('no stock part: "— (all-cash deal)"', () => {
    expect(newSharesLabel(calculate(tuckin))).toBe('— (all-cash deal)');
  });
  test('a stock part and no acquirer price (the fixture): "— (no acquirer share price)", never "nullM"', () => {
    const r = calculate(fixture);
    expect(r.newSharesIssued).toBeNull();
    expect(newSharesLabel(r)).toBe('— (no acquirer share price)');
  });
  test('a real figure prints as before', () => {
    expect(newSharesLabel({ stockPortion: '34600', newSharesIssued: '110' })).toBe('110M');
  });
});
