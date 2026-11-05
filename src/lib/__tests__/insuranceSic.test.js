// The insurer list and the n/m it drives (src/lib/insuranceSic, deckTokens).
const { INSURANCE_SIC, INSURANCE_GROSS_REASON, grossNotMeaningfulReason } = require('../insuranceSic');
const { UTILITY_GROSS_REASON } = require('../utilitySic');
const { isGrossNm, grossNmNote } = require('../../components/deck/shared/deckTokens');

describe('insurers: gross profit and margin are n/m', () => {
  test('every insurance SIC, with the reason', () => {
    ['6311', '6321', '6324', '6331', '6351', '6361', '6399', '6411'].forEach((sic) => {
      expect(INSURANCE_SIC).toContain(sic);
      expect(grossNotMeaningfulReason(sic)).toBe('not meaningful for insurers');
      expect(isGrossNm({ sic })).toBe(true);
    });
    expect(INSURANCE_GROSS_REASON).toBe('not meaningful for insurers');
  });
  test('utilities keep their own reason; everyone else is unaffected', () => {
    expect(grossNotMeaningfulReason('4911')).toBe(UTILITY_GROSS_REASON);
    ['6021', '6282', '6798', '5912', '7372', null, undefined].forEach((sic) => {
      expect(grossNotMeaningfulReason(sic)).toBeNull();
      expect(isGrossNm({ sic })).toBe(false);
    });
    expect(isGrossNm(null)).toBe(false);
  });
  test('the slide note names each reason once, and is byte-identical for a utility', () => {
    expect(grossNmNote({ sic: '6324' })).toBe('Gross profit and gross margin: n/m, not meaningful for insurers.');
    expect(grossNmNote({ sic: '4911' })).toBe('Gross profit and gross margin: n/m, not meaningful for utilities.');
    expect(grossNmNote({ sic: '6324' }, { sic: '6331' })).toBe('Gross profit and gross margin: n/m, not meaningful for insurers.');
    expect(grossNmNote({ sic: '6324' }, { sic: '4911' })).toBe('Gross profit and gross margin: n/m, not meaningful for insurers; not meaningful for utilities.');
    expect(grossNmNote({ sic: '7372' }, null)).toBeNull();
  });
});
