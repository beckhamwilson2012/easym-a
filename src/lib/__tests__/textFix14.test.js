// Fix 14 Task 4: wrong text. The breakeven line, the source line's "as of" date.
import { composeSourceLine, formatDeckDate } from '../composeSourceLine';
import { dealVerdict } from '../dealVerdict';
import { calculate } from '../../utils/dealCalc';

describe('as-of date matches the title slide (local date of the data timestamp)', () => {
  test('a timestamp is shown on its local date, the same formatter the title uses', () => {
    const ts = '2026-11-16T02:30:00.000Z';   // Nov 15 evening in Mountain time
    const fields = { price: { status: 'verified', chosenSource: 'cnbc', sourceMeta: { cnbc: { value: 1, asOf: '2026-11-16' } } } };
    const line = composeSourceLine(['price'], fields, ts);
    expect(line).toContain(`Market data as of ${formatDeckDate(ts)}.`);
    // the old code cut the timestamp to its UTC date, which formatDeckDate keeps as a calendar date
    const local = new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    expect(formatDeckDate(ts)).toBe(local);
  });
});

describe('breakeven at or below zero', () => {
  const tuck = {
    companyARevenue: 801, companyALtmRevenue: 801, companyAEBITDA: 156, companyANetIncome: 166.261, companyACash: 211.553, companyASti: 83.102,
    companyADebt: 0, companyAEPS: 1.95, companyADilutedShares: 85.073, companyAShares: 81.271302, currentSharePriceA: 121,
    companyBRevenue: 50, companyBEBITDA: 5, companyBNetIncome: 20, companyBCash: 10, companyBDebt: 0, companyBLtmRevenue: null,
    companyBShares: 0, companyBEPS: 0, offerPricePerShare: 0, offerValueTotal: 100, cashPercent: 100, applySourcesOfFunds: true,
  };
  test('prints "Accretive before any synergies", never a negative breakeven amount', () => {
    const deal = { _inputs: tuck, _results: calculate(tuck), offerPrice: 0, synergiesY1: 13, synergies: { years: [{ year: 1, ebitda: 13, entered: true }, { year: 2, ebitda: 0, entered: false }, { year: 3, ebitda: 0, entered: false }] } };
    const v = dealVerdict({ deal, model: { derived: {}, verifiedData: { acquirer: {} } }, acquirerFwd: [], targetFwd: [], acquirerName: 'HNGE', targetName: 'Target' });
    expect(v.breakeven).toBeLessThanOrEqual(0);
    expect(v.line).toMatch(/^Accretive before any synergies; entered \$13M\./);
    expect(v.line).not.toMatch(/Breaks even with no synergies|\(\$/);
  });
});
