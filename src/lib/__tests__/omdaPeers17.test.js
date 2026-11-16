// Fix 17 Task 4: the OMDA override is the candidates that pass the automatic stock-peer screen. This replays the
// Nov 16 2026 inputs (OMDA $14.49 × 62.037725M; FMP market caps; SEC SIC and filing dates) through the screen itself.
const { createPeerSelector } = require('../../../server/services/peerSelect');
const { PEER_OVERRIDES } = require('../../../peerOverrides');

const CAPS = { TDOC: 1585954972, PGNY: 2735998644, HIMS: 4195205869, TALK: 870575034 };
const CIK = { OMDA: '0001', TDOC: '0002', PGNY: '0003', HIMS: '0004', HNGE: '0005' };   // TALK: absent from company_tickers.json
const SIC = { '0002': '8011', '0003': '8090', '0004': '8011' };
const sub = (cik) => ({ sic: SIC[cik], filings: { recent: { form: ['10-Q'], filingDate: ['2026-11-05'] } } });

function screen() {
  return createPeerSelector({
    overrides: {},
    cikFor: (t) => CIK[t] || null,
    fetchSubmissions: async (cik) => sub(cik),
    fmpStockPeers: async () => ['TDOC', 'PGNY', 'HIMS', 'TALK'].map((s) => ({ symbol: s, mktCap: CAPS[s] })),
    fmpIndustry: async () => null,
    fmpScreener: async () => [],
    targetMarketCap: async () => ({ value: 14.49 * 62.037725 * 1e6 }),
    revenueAvailable: async () => true,
    now: () => new Date('2026-11-16T12:00:00Z'),
  });
}

test('TDOC, PGNY, HIMS pass; TALK fails as not an SEC filer', async () => {
  const r = await screen()._select('OMDA', 'HNGE');
  expect(r.screened.map((c) => c.ticker)).toEqual(['TDOC', 'PGNY', 'HIMS']);
  expect(r.screened.map((c) => c.ratio)).toEqual([1.7643, 3.0436, 4.6669]);
  expect(r.dropped).toEqual([{ ticker: 'TALK', stage: 'fmp-peers', rule: 'not-sec-filer', detail: 'not in SEC company_tickers.json' }]);
});

test('the override is exactly the passing candidates, at least 3, without the acquirer', () => {
  expect(PEER_OVERRIDES.OMDA).toEqual(['TDOC', 'PGNY', 'HIMS']);
  expect(PEER_OVERRIDES.OMDA.length).toBeGreaterThanOrEqual(3);
  expect(PEER_OVERRIDES.OMDA).not.toContain('HNGE');
});
