// Fix 7b Task 6 — Comparables treated an unknown debt as $0 (`parseFloat(data.debt) || 0`), printing HNGE's EV as
// $9,597M while Company Profiles showed "—". Unknown debt is now "—" for EV, net debt and the EV multiples, with the
// /quote reason in the footnote; a FILED zero is still zero.
import { buildCompany, debtUnknownNote } from '../SectionComparables';

const HNGE_REASON = 'no debt concept is tagged in any 10-K or 10-Q, and no filing states zero debt (checked through the 10-Q 9/30/2026)';
// /quote?symbol=HNGE as captured today (debt null with its reason), at $121.72.
const hnge = (over = {}) => ({
  name: 'Hinge Health, Inc.', revenue: 588, operatingIncome: 90, ebitda: 156, shares: 81.271302, livePrice: 121.72,
  cash: 212, shortTermInvestments: 83, debt: null, debtReason: HNGE_REASON,
  ltm: { trusted: true, revenue: 801, ebitda: 156, operatingIncome: 120, eps: 1.95, netIncome: 168 }, ...over,
});

test('HNGE: unknown debt → EV, net debt, EV/Revenue and EV/EBITDA are "—", equity value still shows', () => {
  const c = buildCompany('HNGE', hnge(), false);
  expect(c.mktCap).toBeCloseTo(81.271302 * 121.72, 6);       // 9,892
  expect(c.ev).toBeNull();                                     // was 9,892 + 0 − 295 = 9,597
  expect(c.netDebt).toBeNull();                                // was (295)
  expect(c.evRevLtm).toBeNull();
  expect(c.evEbitCell).toBe('—');
  expect(c.debtUnknown).toBe(true);
  expect(c.debtReason).toBe(HNGE_REASON);
});

test('a filed zero debt (OMDA, PGNY) is still zero: EV = equity value − cash bucket', () => {
  const c = buildCompany('OMDA', hnge({ debt: 0, debtReason: null }), false);
  expect(c.ev).toBeCloseTo(81.271302 * 121.72 - 295, 6);
  expect(c.netDebt).toBe(-295);
  expect(c.debtUnknown).toBe(false);
});

test('known debt is unchanged', () => {
  const c = buildCompany('TDOC', hnge({ debt: 998, cash: 850, shortTermInvestments: null, debtReason: null }), true);
  expect(c.ev).toBeCloseTo(81.271302 * 121.72 + 998 - 850, 6);
});

test('the footnote names each company with its own reason, one sentence per reason', () => {
  const cols = [
    buildCompany('HNGE', hnge(), false),
    buildCompany('SDGR', hnge({ debtReason: HNGE_REASON }), false),
    buildCompany('AZTA', hnge({ debtReason: 'the latest debt tag is non-zero (LongTermDebt at 2021-12-31) but not at the balance-sheet date, and no filing states zero debt (checked through the 10-Q 6/30/2026)' }), false),
    buildCompany('TDOC', hnge({ debt: 998, debtReason: null }), true),
  ];
  expect(debtUnknownNote(cols)).toBe(
    `Enterprise value, net debt and EV multiples are “—” for HNGE, SDGR: total debt is not shown: ${HNGE_REASON}. `
    + 'Enterprise value, net debt and EV multiples are “—” for AZTA: total debt is not shown: the latest debt tag is non-zero (LongTermDebt at 2021-12-31) but not at the balance-sheet date, and no filing states zero debt (checked through the 10-Q 6/30/2026).');
  expect(debtUnknownNote([cols[3]])).toBeNull();
});
