import { buildNarrative, computeFlags } from '../../utils/dealCalc';
import { multipleNumber, multipleOf } from '../multiples';
import { fmtMult } from '../../components/deck/shared/deckTokens';

// Fix 16 Task 6: text.
describe('risk sentence', () => {
  const base = { totalPurchasePrice: 1149, companyAEPS: 1.98, proFormaEPS: null };
  test('leverage reads as a noun phrase', () => {
    const flags = computeFlags({ debtEBITDA: '39.6', totalPurchasePrice: '1000', newSharesIssued: '1', purchasePremium: '30' }, { companyAShares: 100 });
    expect(flags[0].risk).toBe('High combined leverage');
    expect(buildNarrative(base, { offerPricePerShare: 19.81 }, 'A', 'B', flags))
      .toBe("A's acquisition of B at $19.81/share ($1.1B total). High combined leverage represents the deal's biggest structural risk.");
  });
  test('a flag that already reads as a noun phrase is unchanged', () => {
    const flags = computeFlags({ debtEBITDA: '1.0', totalPurchasePrice: '1000', newSharesIssued: '50', purchasePremium: '30' }, { companyAShares: 100 });
    expect(buildNarrative(base, { offerPricePerShare: 19.81 }, 'A', 'B', flags)).toMatch(/ Significant share dilution represents the deal's biggest structural risk\.$/);
  });
});

describe('multiples: no "-0.0x"; real negatives use the Unicode minus', () => {
  test('multipleNumber', () => {
    expect(multipleNumber(-0.03)).toBe('0.0');
    expect(multipleNumber(-0.06)).toBe('−0.1');
    expect(multipleNumber(-1.94)).toBe('−1.9');
    expect(multipleNumber(-4.1)).toBe('−4.1');
    expect(multipleNumber(0)).toBe('0.0');
    expect(multipleNumber(17.25)).toBe((17.25).toFixed(1));   // positives exactly as before
    expect(multipleNumber('39.6')).toBe('39.6');
    expect(multipleNumber(null)).toBeNull();
  });
  test('the one multiples rule and the deck formatter use it (tuck-in: net debt −5 ÷ EBITDA 161)', () => {
    expect(multipleOf(-5, 161).text).toBe('0.0x');
    expect(multipleOf(-5, 161, { suffix: '×' }).text).toBe('0.0×');
    expect(multipleOf(-306, 161).text).toBe('−1.9x');
    expect(fmtMult(-0.04)).toBe('0.0x');
    expect(fmtMult(12.34)).toBe('12.3x');
  });
});
