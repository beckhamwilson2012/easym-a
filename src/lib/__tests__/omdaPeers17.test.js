// Fix 17 Task 4, re-run under Fix 24's one rule: the OMDA override passes through every keep-filter except industry.
// This replays the Nov 16 2026 inputs (OMDA $14.49 × 62.037725M; FMP market caps; SEC SIC and filing dates) through the
// picker itself, with the real override list.
const { createPeerSelector } = require('../../../server/services/peerSelect');
const { PEER_OVERRIDES } = require('../../../peerOverrides');

const CAPS = { TDOC: 1585954972, PGNY: 2735998644, HIMS: 4195205869 };
const IND = { TDOC: 'Medical - Healthcare Information Services', PGNY: 'Medical - Healthcare Plans', HIMS: 'Medical - Care Facilities' };
const CIK = { OMDA: '0001', TDOC: '0002', PGNY: '0003', HIMS: '0004', HNGE: '0005' };   // TALK: absent from company_tickers.json
const SIC = { '0001': '8000', '0002': '8011', '0003': '8090', '0004': '8011', '0005': '7374' };
const sub = (cik) => ({ sic: SIC[cik], filings: { recent: { form: ['10-Q'], filingDate: ['2026-11-05'] } } });

function screen(overrides) {
  return createPeerSelector({
    overrides,
    cikFor: (t) => CIK[t] || null,
    tickersForCik: (cik) => Object.keys(CIK).filter((t) => CIK[t] === cik),
    fetchSubmissions: async (cik) => sub(cik),
    fmpStockPeers: async () => [],
    fmpProfile: async (t) => (t === 'OMDA' ? { industry: 'Medical - Healthcare Information Services', sector: 'Healthcare', country: 'US' } : null),
    fmpUniverse: async (lo, hi) => Object.entries(CAPS).filter(([, c]) => c >= lo && c <= hi)
      .map(([symbol, marketCap]) => ({ symbol, marketCap, industry: IND[symbol], sector: 'Healthcare' })),
    sicCompanies: async () => [],
    registrationBlock: async () => null,
    targetMarketCap: async () => ({ value: 14.49 * 62.037725 * 1e6 }),
    dataAvailable: async () => ({ price: true, shares: true, revenue: true }),
    now: () => new Date('2026-11-16T12:00:00Z'),
  });
}

test('the OMDA override passes the size, registration and data filters: TDOC, PGNY, HIMS, hand-set', async () => {
  const r = await screen(PEER_OVERRIDES)._select('OMDA', 'HNGE');
  expect(r.peers).toEqual(['TDOC', 'PGNY', 'HIMS']);
  expect(r.screened.map((c) => c.ratio)).toEqual([1.7643, 3.0436, 4.6669]);
  expect(Object.values(r.peerSources)).toEqual(['override', 'override', 'override']);
  expect(r.trust).toBe('trusted');
  expect(r.dropped).toEqual([]);
});

test('TALK is not an SEC filer, so it could not be on the list', async () => {
  const r = await screen({ OMDA: ['TDOC', 'PGNY', 'HIMS', 'TALK'] })._select('OMDA', 'HNGE');
  expect(r.peers).toEqual(['TDOC', 'PGNY', 'HIMS']);
  expect(r.dropped).toEqual([{ ticker: 'TALK', stage: 'override', rule: 'not-sec-filer', detail: 'not in SEC company_tickers.json' }]);
});

test('the override is exactly the passing candidates, at least 3, without the acquirer', () => {
  expect(PEER_OVERRIDES.OMDA).toEqual(['TDOC', 'PGNY', 'HIMS']);
  expect(PEER_OVERRIDES.OMDA.length).toBeGreaterThanOrEqual(3);
  expect(PEER_OVERRIDES.OMDA).not.toContain('HNGE');
});
