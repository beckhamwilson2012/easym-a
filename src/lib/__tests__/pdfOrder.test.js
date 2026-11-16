// Fix 14 Task 7: the exported PDF prints the Deal Summary as the first page after the Title. Exhibit letters don't move.
import { DECK_ORDER, pdfOrder, setActiveSections, pageNumOf, exhibitLabelOf, resetActiveSections } from '../../components/deck/deckRegistry';

afterEach(() => resetActiveSections());

test('PDF order: Title, Deal Summary, then the exhibits; screen order keeps the Deal Summary first', () => {
  expect(DECK_ORDER[0].id).toBe('dashboard');
  const pdf = pdfOrder(DECK_ORDER.filter((s) => s.showInPdf)).map((s) => s.id);
  expect(pdf.slice(0, 3)).toEqual(['title', 'dashboard', 'comparables']);
});

test('page numbers follow the PDF; exhibit letters are unchanged', () => {
  const ids = pdfOrder(DECK_ORDER.filter((s) => s.showInPdf && !['privatevaluation', 'creditstats'].includes(s.id))).map((s) => s.id);
  setActiveSections(ids);
  expect(pageNumOf('title')).toBe(1);
  expect(pageNumOf('dashboard')).toBe(2);
  expect(pageNumOf('comparables')).toBe(3);
  expect(exhibitLabelOf('comparables')).toBe('Exhibit A');
  expect(exhibitLabelOf('dashboard')).toBeNull();
});

test('a list without a Deal Summary is returned as is', () => {
  const s = [{ id: 'title' }, { id: 'comparables' }];
  expect(pdfOrder(s)).toBe(s);
});
