// Fix 17 Task 9: the 10-K XBRL revenue split, shown only when it ties to filed revenue within 0.5%; FMP within 2% only
// when the 10-K has none. The XML mirrors OMDA's FY2025 10-K (0001628280-26-015637): Service 241,043K + Hardware 19,167K.
const { splitsFromInstance, pickBox, humanize } = require('../../../server/services/revenueSplit');
import { chooseSplit } from '../../components/deck/sections/SectionTargetOverview';

const ctx = (id, start, end, dims = []) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${dims.length ? `<xbrli:segment>${dims.map(([d, m]) => `<xbrldi:explicitMember dimension="${d}">${m}</xbrldi:explicitMember>`).join('')}</xbrli:segment>` : ''}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const fact = (c, v) => `<us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="${c}" unitRef="usd" decimals="-3">${v}</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>`;
const xml = (hardware) => [
  '<dei:DocumentFiscalYearFocus contextRef="t">2025</dei:DocumentFiscalYearFocus>',
  '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>',
  ctx('t', '2025-01-01', '2025-12-31'), ctx('svc', '2025-01-01', '2025-12-31', [['srt:ProductOrServiceAxis', 'us-gaap:ServiceMember']]),
  ctx('hw', '2025-01-01', '2025-12-31', [['srt:ProductOrServiceAxis', 'omda:HardwareMember']]),
  ctx('seg', '2025-01-01', '2025-12-31', [['us-gaap:StatementBusinessSegmentsAxis', 'omda:ReportableSegmentMember']]),
  ctx('py', '2024-01-01', '2024-12-31'),
  fact('t', 260210000), fact('svc', 241043000), fact('hw', hardware), fact('seg', 260210000), fact('py', 169789000),
].join('\n');

test('OMDA: members tie to the filed total → shown, labeled with the 10-K year and axis', () => {
  const box = pickBox(splitsFromInstance(xml(19167000)), 'product', '10-K');
  expect(box.ok).toBe(true);
  expect(box.label).toBe('SEC 10-K FY2025, product or service axis');
  expect(box.segments.map((s) => [s.label, s.value])).toEqual([['Service', 241043000], ['Hardware', 19167000]]);
  expect(box.sum).toBe(260210000);
  expect(box.total).toBe(260210000);
});

test('a single-member segment axis is not a split; members off by more than 0.5% are not shown', () => {
  const found = splitsFromInstance(xml(37400000));   // FMP's hardware figure: 278.4 vs 260.2
  const box = pickBox(found, 'product', '10-K');
  expect(box.ok).toBe(false);
  expect(box.reason).toMatch(/within 0.5%/);
  expect(pickBox(found, 'geo', '10-K')).toEqual({ ok: false, reason: 'the 10-K tags no geographic revenue split', checked: [] });
});

test('0.5% is the line', () => {
  expect(pickBox(splitsFromInstance(xml(19167000 + 1301000)), 'product', '10-K').ok).toBe(true);    // +0.4999%
  expect(pickBox(splitsFromInstance(xml(19167000 + 1302000)), 'product', '10-K').ok).toBe(false);   // +0.5004%
});

test('labels', () => {
  expect(humanize('us-gaap:NonUsMember')).toBe('Non-US');
  expect(humanize('country:US')).toBe('US');
  expect(humanize('ko:FinishedProductOperationsMember')).toBe('Finished Product Operations');
});

describe('chooseSplit — SEC first, FMP within 2%, else today\'s message', () => {
  const actuals = [{ fy: 2025, revenue: 260 }];
  const fmpOff = { ok: true, year: '2025', segments: [{ label: 'Service', value: 241.0e6 }, { label: 'Hardware', value: 37.4e6 }] };
  const fmpOk = { ok: true, year: '2025', segments: [{ label: 'A', value: 200e6 }, { label: 'B', value: 62e6 }] };
  const sec = { ok: true, source: 'sec', label: 'SEC 10-K FY2025, product or service axis', segments: [{ label: 'Service', value: 1 }] };
  test('SEC wins even when FMP ties', () => expect(chooseSplit(sec, fmpOk, actuals).source).toBe('sec'));
  test('no SEC, FMP within 2% → FMP', () => expect(chooseSplit({ ok: false }, fmpOk, actuals).source).toBe('fmp'));
  test('no SEC, FMP off by 7% → the mismatch message', () => {
    const r = chooseSplit({ ok: false }, fmpOff, actuals);
    expect(r.seg).toBeNull();
    expect(Math.round(r.mismatch.sum)).toBe(278);
  });
});
