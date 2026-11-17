import { DECK_ORDER, pdfOrder, screenPageNumbers } from '../deckRegistry';

// Fix 19 Task 1: on screen, Deal Summary 1, Title 2, the rest unchanged; the PDF keeps the Title as page 1.
describe('Fix 19 Task 1 — slide order', () => {
  const pub = DECK_ORDER.filter((s) => !['privatevaluation', 'creditstats'].includes(s.id));
  test('screen order and numbers: Deal Summary 1, Title 2, Executive Summary unnumbered, Comparables 3', () => {
    expect(pub.slice(0, 4).map((s) => s.id)).toEqual(['dashboard', 'title', 'execsummary', 'comparables']);
    const n = screenPageNumbers(pub);
    expect([n.dashboard, n.title, n.execsummary, n.comparables, n.verification2]).toEqual([1, 2, undefined, 3, 18]);
  });
  test('PDF order is unchanged: Title page 1, Deal Summary page 2, everything after identical to screen', () => {
    const pdf = pdfOrder(pub.filter((s) => s.showInPdf)).map((s) => s.id);
    expect(pdf.slice(0, 3)).toEqual(['title', 'dashboard', 'comparables']);
    const scr = pub.filter((s) => s.showInPdf).map((s) => s.id);
    expect(pdf.slice(2)).toEqual(scr.slice(2));
  });
});
