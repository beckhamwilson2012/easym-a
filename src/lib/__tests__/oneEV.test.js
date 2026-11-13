import { enterpriseValue, evClaims, evClaimsNote, evClaimsFootnote, claimsOf } from '../netDebt';
import { calculate } from '../../utils/dealCalc';

// Fix 10 Task 5: one enterprise value. The Deal Summary's EV (price + debt − cash) and the transaction EV (price + net
// debt on the cash bucket) disagreed for NET/DDOG: ≈ $86.7B vs $82.3B (DDOG short-term investments $4,352M).
const ddog = { offerPricePerShare: 239.80, companyBShares: 361.042545, cashPercent: 60, currentSharePriceA: 318.5,
  companyANetIncome: 342.882, companyAEPS: 0.93, companyADilutedShares: 370.274, companyBNetIncome: 746.582, companyBEPS: 2.05,
  companyBEBITDA: 1000, companyBDebt: 987, companyBCash: 881, companyBSti: 4352 };

describe('Fix 10 Task 5 — one enterprise value', () => {
  test('dealCalc EV nets short-term investments (the cash bucket), so it equals the transaction EV', () => {
    const r = calculate(ddog);
    const price = 239.80 * 361.042545;
    expect(r.enterpriseValueFull).toBeCloseTo(price + 987 - 881 - 4352, 6);
    expect(r.enterpriseValueFull).toBe(enterpriseValue(price, 987, 881, 4352));
    expect((r.enterpriseValueFull / 1000).toFixed(1)).toBe('82.3');
    expect(r.evEBITDA).toBe((r.enterpriseValueFull / 1000).toFixed(1));     // EV/EBITDA is on that same EV
  });
  test('tagged noncontrolling interest and preferred stock are added; untagged adds nothing and is said', () => {
    const claims = { nci: 1900, nciTag: 'MinorityInterest', preferred: null, preferredTag: null };
    expect(evClaims(claims)).toBe(1900);
    expect(enterpriseValue(100, 50, 20, 10, claims)).toBe(100 + 50 - 30 + 1900);
    expect(evClaimsNote(claims, 'KO')).toBe('KO: EV adds noncontrolling interest $1,900M (MinorityInterest); no preferred tagged.');
    expect(evClaimsNote({ nci: null, preferred: null }, 'HNGE')).toBe('HNGE: no noncontrolling interest or preferred tagged.');
    expect(evClaimsNote(null, 'HNGE')).toBe('HNGE: no noncontrolling interest or preferred tagged.');
    const r = calculate({ ...ddog, companyBClaims: { nci: 100, nciTag: 'MinorityInterest', preferred: 0, preferredTag: 'PreferredStockValue' } });
    expect(r.enterpriseValueFull).toBeCloseTo(239.80 * 361.042545 + 987 - 881 - 4352 + 100, 6);
  });
  test('a filed 0 is a real 0 and is named; null debt still gives null EV (never 0)', () => {
    expect(evClaimsNote({ nci: null, preferred: 0, preferredTag: 'PreferredStockValue' }, 'X')).toBe('X: EV adds preferred stock $0M (PreferredStockValue); no noncontrolling interest tagged.');
    expect(enterpriseValue(100, null, 20, 10, { nci: 5 })).toBeNull();
  });
  test('claims come from /quote fields; Comparables groups untagged tickers', () => {
    expect(claimsOf({ noncontrollingInterest: 12, noncontrollingInterestTag: 'MinorityInterest' })).toMatchObject({ nci: 12, preferred: null });
    expect(evClaimsFootnote([{ ticker: 'NET', claims: claimsOf({}) }, { ticker: 'KO', claims: { nci: 1900, nciTag: 'MinorityInterest' } }, { ticker: 'DDOG', claims: null }]))
      .toBe('KO: EV adds noncontrolling interest $1,900M (MinorityInterest); no preferred tagged. Enterprise value: no noncontrolling interest or preferred tagged for NET, DDOG.');
  });
});
