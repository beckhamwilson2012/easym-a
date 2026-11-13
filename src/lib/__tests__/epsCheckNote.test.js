// Fix 7b Task 5 — the ⓘ beside DDOG's adjusted EPS. The text comes from the payload's own check method, never a
// hardcoded ticker: only an EPS the server tied as net income ÷ diluted shares (no per-share adjustments) gets one.
import { epsCheckNote, reportedNonGaap } from '../reportingBasis';

// The live /api/nongaap/DDOG figures (FY2025 release 0001628280-26-006645, table 10).
const ddog = {
  ticker: 'DDOG', fiscalYear: 2025, sourceAccession: '0001628280-26-006645',
  figures: {
    eps: { value: 2.05, method: 'net-income identity', rowLabel: 'Net income per share after non-GAAP tax adjustments - diluted' },
    netIncome: { value: 746.582 },
    dilutedShares: { value: 363.471 },
  },
  reasons: {},
};
const net = { ...ddog, figures: { ...ddog.figures, eps: { value: 0.93, method: 'additive per-share reconciliation' }, netIncome: { value: 330 }, dilutedShares: { value: 355 } } };

test('DDOG: the brief\'s text, and the quotient really ties (746.582 ÷ 363.471 = 2.054)', () => {
  const e = reportedNonGaap(ddog).eps;
  expect(e.checkMethod).toBe('net-income identity');
  expect(epsCheckNote('DDOG', e)).toBe("DDOG doesn't list per-share adjustments, so $2.05 is checked as filed non-GAAP net income ÷ filed non-GAAP diluted shares. It ties to the cent.");
});

test('a per-share reconciliation (NET) gets no ⓘ', () => {
  expect(epsCheckNote('NET', reportedNonGaap(net).eps)).toBeNull();
});

test('a quotient that does not round to the filed EPS says so, with the figures', () => {
  const off = { value: 2.10, netIncome: 746.582, dilutedShares: 363.471, checkMethod: 'net-income identity' };
  expect(epsCheckNote('DDOG', off)).toMatch(/It does not tie: 2\.054 against the filed \$2\.10\./);
});

test('missing legs: no note, never a computed one', () => {
  expect(epsCheckNote('DDOG', null)).toBeNull();
  expect(epsCheckNote('DDOG', { value: 2.05, netIncome: null, dilutedShares: 363.471, checkMethod: 'net-income identity' })).toBeNull();
});
