/** @jest-environment node */
// Fix 7b Task 2 — ONE pro-forma debt and cash figure. Transaction Structure, Credit Stats and the Deal Summary's
// Debt / EBITDA all read dealCalc's proFormaCapitalization result; none sums debt or cash itself.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculate, proFormaCapitalization, acquisitionNewDebt } from '../../../../utils/dealCalc';
import { SectionTransactionStructure } from '../SectionTransactionStructure';
import { SectionCreditStats } from '../SectionCreditStats';

const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').split('\n').map((s) => s.trim()).filter(Boolean);

// STAGE_11E_PRIVATE_NOOP_INPUTS.json as the deck resolves it.
const fixture = {
  companyARevenue: 50000, companyAEBITDA: 15000, companyANetIncome: 10000, companyACash: 5000, companyADebt: 2000,
  companyBRevenue: 10000, companyBEBITDA: 3000, companyBNetIncome: 2000, companyBCash: 1000, companyBDebt: 500,
  companyALtmRevenue: null, companyBLtmRevenue: null, offerPricePerShare: 0, offerValueTotal: 90000, cashPercent: 60,
  synergiesY1: 600, synergiesY2: 960, synergiesY3: 1320, applySourcesOfFunds: true,
};
// The HNGE tuck-in: HNGE debt has no filed figure (null), cash 211.553 + ST 83.102; private target $10M cash, $0 debt.
const tuckin = {
  companyARevenue: 588, companyALtmRevenue: 801, companyAEBITDA: 156, companyANetIncome: 166, companyACash: 211.553, companyASti: 83.102, companyADebt: null,
  companyAEPS: 1.95, companyADilutedShares: 85.073, companyAShares: 81.271302, currentSharePriceA: 121,
  companyBRevenue: 50, companyBEBITDA: 5, companyBNetIncome: 2, companyBCash: 10, companyBDebt: 0, companyBLtmRevenue: null,
  offerPricePerShare: 0, offerValueTotal: 300, cashPercent: 100, applySourcesOfFunds: true,
};
const deckOf = (inp) => {
  const r = calculate(inp);
  return { _results: r, _inputs: inp, totalPrice: parseFloat(r.totalPurchasePrice), combinedEBITDA: parseFloat(r.combinedEBITDA) };
};
const row = (lines, label) => lines[lines.indexOf(label) + 1];

describe('proFormaCapitalization', () => {
  test('private fixture: target debt repaid, cash after the excess cash used', () => {
    const c = calculate(fixture).capitalization;
    expect(c.preDebt).toBe(2500);
    expect(c.proFormaDebt).toBe(2000 + 49700);           // acquirer 2,000 + new debt 49,700
    expect(c.preCash).toBe(6000);
    expect(c.proFormaCash).toBe(6000 - 4800);            // 1,200 = the retained minimum
    expect(c.proFormaNetDebt).toBe(51700 - 1200);
  });

  test('Deal Summary Debt / EBITDA is on the same pro-forma debt', () => {
    const r = calculate(fixture);
    expect(r.combinedDebt).toBe('51700');
    expect(r.debtEBITDA).toBe((51700 / 18600).toFixed(1));   // 2.8x, was (2,000 + 500 + 54,000) / 18,600 = 3.0x
  });

  test('an acquirer with no filed debt: every debt total is null, the cash still computes', () => {
    const r = calculate(tuckin);
    const c = r.capitalization;
    expect(c.preDebt).toBeNull();
    expect(c.proFormaDebt).toBeNull();
    expect(c.proFormaNetDebt).toBeNull();
    expect(c.preCash).toBeCloseTo(211.553 + 83.102 + 10, 9);
    expect(c.proFormaCash).toBeCloseTo(c.preCash - acquisitionNewDebt(tuckin).excessCashUsed, 9);
    expect(r.debtEBITDA).toBe('N/A');
    expect(r.combinedDebt).toBeNull();
  });

  test('an unknown cash side makes cash null, never a 0-coerced bucket', () => {
    const inp = { ...fixture, companyBCash: null };
    const c = proFormaCapitalization(inp, acquisitionNewDebt(inp));
    expect(c.preCash).toBeNull();
    expect(c.proFormaCash).toBeNull();
  });

  test('bank deal: target debt stays outstanding, no cash drawn', () => {
    const inp = { ...fixture, bankDeal: true };
    const s = acquisitionNewDebt(inp);
    const c = proFormaCapitalization(inp, s);
    expect(c.proFormaDebt).toBe(2500 + s.newDebt);
    expect(c.cashUsed).toBe(0);
    expect(c.proFormaCash).toBe(6000);
  });
});

describe('Transaction Structure and Credit Stats print the same figures', () => {
  test('private fixture', () => {
    const deal = deckOf(fixture);
    const ts = text(<SectionTransactionStructure deal={deal} acquirer={{ name: 'Acquirer' }} target={{ name: 'Target Company' }} model={{ derived: {} }} pageNum={1} exhibitLabel="G" />);
    const cs = text(<SectionCreditStats deal={deal} acquirer={{ name: 'Acquirer' }} target={{ name: 'Target Company' }} pageNum={2} exhibitLabel="J" />);
    const iDebt = ts.indexOf('Total debt');
    expect(ts.slice(iDebt + 1, iDebt + 4)).toEqual(['$2,500M', '+$49.2B', '$51.7B']);
    const iCash = ts.indexOf('Cash, equiv. & ST marketable sec.');
    expect(ts.slice(iCash + 1, iCash + 4)).toEqual(['$6,000M', '−$4,800M', '$1,200M']);
    expect(row(cs, 'Pro-forma total debt (incl. acquisition financing; target debt repaid)')).toBe('$51,700M');
    expect(row(cs, 'Pro-forma cash, equiv. & ST marketable sec. (after cash used in the deal)')).toBe('$1,200M');
    expect(row(cs, 'Net debt')).toBe('$50,500M');
  });

  test('HNGE tuck-in: debt "—" on both slides, cash identical', () => {
    const deal = deckOf(tuckin);
    const ts = text(<SectionTransactionStructure deal={deal} acquirer={{ ticker: 'HNGE' }} target={{ name: 'Target Company' }} model={{ derived: {} }} pageNum={1} exhibitLabel="G" />);
    const cs = text(<SectionCreditStats deal={deal} acquirer={{ ticker: 'HNGE' }} target={{ name: 'Target Company' }} pageNum={2} exhibitLabel="J" />);
    const iDebt = ts.indexOf('Total debt');
    expect(ts[iDebt + 1]).toBe('—');
    expect(row(cs, 'Pro-forma total debt (incl. acquisition financing; target debt repaid)')).toBe('—');
    const pf = deal._results.capitalization.proFormaCash;
    expect(row(cs, 'Pro-forma cash, equiv. & ST marketable sec. (after cash used in the deal)')).toBe(`$${Math.round(pf)}M`);
    const iCash = ts.indexOf('Cash, equiv. & ST marketable sec.');
    expect(ts[iCash + 3]).toBe(`$${Math.round(pf)}M`);
  });
});
