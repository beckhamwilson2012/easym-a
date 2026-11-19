// Fix 23 Task 2: the input page names the exempt deal from dealCalc's one exemption (fundingExempt), never "Bank deal" for insurers.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { acquisitionNewDebt } from '../../utils/dealCalc';
import { CashFundingBox } from '../../components/shared/CashFundingBox';

const base = { applySourcesOfFunds: true, companyBShares: 343, offerPricePerShare: 158, cashPercent: 50, companyBDebt: 19768, companyACash: 1, companyBCash: 1, companyALtmRevenue: 1, companyBLtmRevenue: 1 };
const box = (f) => { render(<CashFundingBox funding={f} targetName="PRU" />); fireEvent.click(screen.getByText(/How the cash part gets paid/)); return screen.getByTestId('cash-box').textContent; };

test.each([
  ['insurers (MET/PRU)', { companyASic: '6311', companyBSic: '6311' }],
  ['banks (JPM/BAC)', { bankDeal: true, companyASic: '6021', companyBSic: '6021' }],
])('%s: "Financial institution deal", the whole cash part is new debt', (_, sics) => {
  const f = acquisitionNewDebt({ ...base, ...sics });
  expect(f.bank).toBe(true);
  expect(box(f)).toBe('Financial institution deal: cash on hand is not used, so the whole cash part ($27.1B) is new debt.');
});

test('an ordinary deal is not exempt and shows the cash rows', () => {
  const f = acquisitionNewDebt({ ...base, companyASic: '2080', companyBSic: '6311' });
  expect(f.bank).toBe(false);
  expect(box(f)).not.toMatch(/deal: cash on hand is not used/);
  expect(screen.getByTestId('cash-newdebt')).toBeTruthy();
});
