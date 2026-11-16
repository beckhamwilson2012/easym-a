import { orderHolders } from '../SectionShareholderAnalysis';

// Fix 17 Task 8: OMDA's DEF 14A (2026-04-28) lists directors/officers first and the 5% holders last.
const omda = [
  { name: 'Sean Duffy', section: 'insider', pct: 3.26 },
  { name: 'Wei-Li Shao', section: 'insider', pct: 1.17 },
  { name: 'Steve Cook', section: 'insider', pct: '*' },
  { name: 'All current directors and executive officers as a group (10 persons)', section: 'insider', pct: 6.38 },
  { name: 'Entities Affiliated with Revelation Partners', section: '5% holder', pct: 8.77 },
  { name: 'Entities affiliated with Divisadero Street Capital Management, LP', section: '5% holder', pct: 8.51 },
  { name: 'FMR LLC', section: '5% holder', pct: 8.27 },
  { name: 'Cigna Ventures, LLC', section: '5% holder', pct: 5.80 },
  { name: 'Entities affiliated with Andreessen Horowitz', section: '5% holder', pct: 6.09 },
];

test('5% holders first, largest to smallest, then directors/officers in the proxy order', () => {
  expect(orderHolders(omda, false).map((h) => h.name.slice(0, 12))).toEqual([
    'Entities Aff', 'Entities aff', 'FMR LLC', 'Entities aff', 'Cigna Ventur',
    'Sean Duffy', 'Wei-Li Shao', 'Steve Cook', 'All current ',
  ]);
  expect(orderHolders(omda, false).slice(0, 5).map((h) => h.pct)).toEqual([8.77, 8.51, 8.27, 6.09, 5.80]);
});

test('rows before the director heading are holders; "<1%" sorts after numbers; nothing is dropped', () => {
  const rows = [{ name: 'X', section: null, pct: '*' }, { name: 'Vanguard', section: null, pct: 9.1 }, { name: 'D', section: 'insider', pct: 0.5 }];
  expect(orderHolders(rows, false).map((h) => h.name)).toEqual(['Vanguard', 'X', 'D']);
  expect(orderHolders(omda, false)).toHaveLength(omda.length);
});

test('dual class sorts holders by voting %', () => {
  const rows = [{ name: 'A', section: '5% holder', votingPct: 2, pctA: 9 }, { name: 'B', section: '5% holder', votingPct: 7, pctA: 1 }];
  expect(orderHolders(rows, true).map((h) => h.name)).toEqual(['B', 'A']);
});
