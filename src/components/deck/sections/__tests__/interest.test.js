/** @jest-environment node */
// Fix 7b Task 3 — interest and financing cost go through ONE formatter (deckTokens.fmtInterest): one decimal under
// $10M, so $12M of new debt shows $0.6M of interest, not "$0M"; $10M and up prints exactly as before.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculate } from '../../../../utils/dealCalc';
import { fmtInterest, fmtMoneyTable } from '../../shared/deckTokens';
import { SectionCreditStats } from '../SectionCreditStats';

const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').split('\n').map((s) => s.trim()).filter(Boolean);
const row = (lines, label) => lines[lines.indexOf(label) + 1];

describe('fmtInterest', () => {
  test('under $10M: one decimal', () => {
    expect(fmtInterest(0.474)).toBe('$0.5M');
    expect(fmtInterest(0.601)).toBe('$0.6M');
    expect(fmtInterest(9.94)).toBe('$9.9M');
    expect(fmtInterest(-0.474)).toBe('($0.5M)');
    expect(fmtInterest(0)).toBe('$0.0M');                       // a genuine zero drag is a value, shown as one
    expect(fmtInterest(0.474, { unit: '' })).toBe('$0.5');       // Pro Forma slide's unitless $M cells
  });
  test('$10M and up: the slide formatter, unchanged', () => {
    expect(fmtInterest(1916.4)).toBe(fmtMoneyTable(1916.4));     // $1,916M
    expect(fmtInterest(10)).toBe(fmtMoneyTable(10));
    expect(fmtInterest(12345)).toBe(fmtMoneyTable(12345));       // $12.3B
    const whole = (v) => `W${Math.round(v)}`;
    expect(fmtInterest(-1916.4, { whole })).toBe('W-1916');
  });
  test('absent: a dash, never $0', () => {
    expect(fmtInterest(null)).toBe('—');
    expect(fmtInterest(undefined)).toBe('—');
    expect(fmtInterest('n/a')).toBe('—');
  });
});

describe('dealCalc carries interest at full precision', () => {
  const tuckin = {
    companyARevenue: 588, companyALtmRevenue: 801, companyAEBITDA: 156, companyANetIncome: 166, companyACash: 211.553, companyASti: 83.102, companyADebt: null,
    companyAEPS: 1.95, companyADilutedShares: 85.073, companyAShares: 81.271302, currentSharePriceA: 121,
    companyBRevenue: 50, companyBEBITDA: 5, companyBNetIncome: 2, companyBCash: 10, companyBDebt: 0, companyBLtmRevenue: null,
    offerPricePerShare: 0, offerValueTotal: 300, cashPercent: 100, applySourcesOfFunds: true,
  };
  test('$12.4M of new debt: $0.6M pre-tax, $0.49M after tax — not "0"', () => {
    const r = calculate(tuckin);
    const nd = parseFloat(r.newDebt);
    expect(nd).toBe(12);
    expect(r.newInterestPreTax).toBeCloseTo((300 - (211.553 + 83.102 + 10 - 0.02 * 851)) * 0.05, 9);   // 12.365 × 5%
    expect(r.newInterestAfterTax).toBeCloseTo(r.newInterestPreTax * 0.79, 9);
    expect(fmtInterest(r.newInterestAfterTax)).toBe('$0.5M');
  });
  test('Credit Stats prints the pre-tax interest through the one formatter, and coverage on the unrounded figure', () => {
    const r = calculate(tuckin);
    const cs = text(<SectionCreditStats deal={{ _results: r, _inputs: tuckin }} pageNum={1} exhibitLabel="J" />);
    expect(row(cs, 'Pro-forma interest expense (pre-tax, on new debt)')).toBe('$0.6M');
    const cov = parseFloat(r.combinedEBITDA) / r.newInterestPreTax;
    expect(row(cs, 'Interest coverage (EBITDA / interest)')).toBe(`${cov.toFixed(1)}×`);
  });
  test('a large drag prints as before', () => {
    const fixture = {
      companyARevenue: 50000, companyAEBITDA: 15000, companyANetIncome: 10000, companyACash: 5000, companyADebt: 2000,
      companyBRevenue: 10000, companyBEBITDA: 3000, companyBNetIncome: 2000, companyBCash: 1000, companyBDebt: 500,
      offerPricePerShare: 0, offerValueTotal: 90000, cashPercent: 60, synergiesY1: 600, applySourcesOfFunds: true,
    };
    const r = calculate(fixture);
    const cs = text(<SectionCreditStats deal={{ _results: r, _inputs: fixture }} pageNum={1} exhibitLabel="J" />);
    expect(row(cs, 'Pro-forma interest expense (pre-tax, on new debt)')).toBe('$2,485M');   // 49,700 × 5%
    expect(fmtInterest(r.newInterestAfterTax)).toBe('$1,963M');                             // 49,700 × 5% × 0.79 = 1,963.15
  });
});
