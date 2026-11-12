// Task 8 (FIX7A): one market-cap definition shared by the server's peer screen and the slides.
import { marketCapM } from '../marketCap';
import { buildCompany } from '../../components/deck/sections/SectionComparables';

test('HNGE: 81.271302M class-summed cover shares × $121.72 = $9,892.34M', () => {
  expect(marketCapM(121.72, 81.271302)).toBeCloseTo(9892.3429, 4);
});

test('null, never 0, when either input is absent, zero or not a number', () => {
  [[null, 81], [121.72, null], [0, 81], [121.72, 0], ['', 81], [NaN, 81], [121.72, undefined]].forEach(([p, s]) => {
    expect(marketCapM(p, s)).toBeNull();
  });
});

test('the Comparables equity-value cell is the helper\'s product, to the dollar', () => {
  const data = { revenue: 801, livePrice: 121.72, shares: 81.271302, cash: 212, debt: null, shortTermInvestments: 83 };
  expect(buildCompany('HNGE', data, false).mktCap).toBe(marketCapM(121.72, 81.271302));
});

test('the server reads the same module (CommonJS) and multiplies in the same order', () => {
  // server.js targetMarketCap: marketCapM(price, shares) * 1e6 — the slide's $M figure in dollars.
  // eslint-disable-next-line global-require
  const cjs = require('../marketCap');
  expect(cjs.marketCapM(16.42, 178)).toBe(16.42 * 178);
});
