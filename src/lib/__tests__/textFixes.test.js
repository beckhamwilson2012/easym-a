import { fmtPerShare } from '../../components/deck/shared/deckTokens';
import { formatDeckDate } from '../composeSourceLine';
import { buildNarrative } from '../../utils/dealCalc';

// Fix 10 Task 8: "$-0.36" → "−$0.36"; a timestamp is shown on the viewer's local date.
describe('Fix 10 Task 8 — small text fixes', () => {
  test('negative per-share figures put the minus before the dollar sign', () => {
    expect(fmtPerShare(-0.36)).toBe('−$0.36');
    expect(fmtPerShare('-7.77')).toBe('−$7.77');
    expect(fmtPerShare(1.95)).toBe('$1.95');
    expect(fmtPerShare(-0.001)).toBe('$0.00');           // rounds to zero: no "−$0.00"
    expect(fmtPerShare(null)).toBe('N/A');
  });
  test('the narrative uses the same sign rule', () => {
    const t = buildNarrative({ companyAEPS: '1.95', proFormaEPS: '-0.36', epsChangePct: null, totalPurchasePrice: '2011' },
      { offerPricePerShare: 11.30, companyBShares: 178 }, 'Hinge Health, Inc.', 'Teladoc Health, Inc.', []);
    expect(t).toMatch(/from \$1\.95 to −\$0\.36/);
    expect(t).not.toMatch(/\$-/);
  });
  test('a UTC timestamp is formatted on the local date; a bare date stays as filed', () => {
    const ts = '2026-11-13T02:16:12.129Z';
    expect(formatDeckDate(ts)).toBe(new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    expect(formatDeckDate('2026-09-30')).toBe('September 30, 2026');
  });
});
