import { dealEpsMethodText } from '../dealVerdict';
import { epsSourceText, NON_GAAP } from '../reportingBasis';

// Fix 19 Task 5: the note says the deal uses net income ÷ the one diluted count, with the reported EPS as a reference.
describe('Fix 19 Task 5 — EPS method note', () => {
  const ngPlan = { eps: { nonGaap: true, A: { ltmReported: true, value: 2.24 }, B: { computed: true, label: 'Computed by EasyM&A' } }, tickers: { A: 'HNGE', B: 'OMDA' } };
  const inputs = { reportingBasis: NON_GAAP, companyANetIncome: 188.403, companyAEPS: 2.24, companyADilutedShares: 85.0, companyAShares: 81.27, companyABasis: 'ltm' };
  test('Non-GAAP: HNGE NI ÷ 85.0M = $2.22, $2.24 as reference', () => {
    const t = dealEpsMethodText({ _inputs: inputs, reportingBasis: ngPlan }, 'HNGE');
    expect(t).toMatch(/^the deal uses HNGE non-GAAP net income ÷ 85\.0M diluted shares \(\$2\.22\)/);
    expect(t).toMatch(/with \$2\.24 shown as the company-reported reference \(sum of four quarterly releases\)$/);
    expect(epsSourceText(ngPlan, {}, { A: t })).toBe(`HNGE: ${t}; OMDA: Computed by EasyM&A`);
  });
  test('a missing figure gives no note, never a filled one', () => {
    expect(dealEpsMethodText({ _inputs: { ...inputs, companyANetIncome: null } }, 'HNGE')).toBeNull();
  });
  test('epsSourceText is unchanged without an override', () => {
    expect(epsSourceText(ngPlan)).toBe('HNGE: company reported, sum of four quarterly releases; OMDA: Computed by EasyM&A');
  });
});
