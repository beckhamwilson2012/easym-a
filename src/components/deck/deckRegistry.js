// ── Deck registry — the SINGLE source of section order + kind ────────────────────────────────────────────
// Exhibit letters (A, B, …) and appendix romans (I, II, …) DERIVE from this order, the same way page numbers
// already do — so inserting / reordering / removing a section updates every label and every prose cross-ref
// automatically (7E shifted 5 letters by hand, 7H shifted 3 more and left §10's "Exhibit J" stale from 7E
// through 7H; this closes that class of bug).
//
// This module holds ONLY metadata (id / kind / showInPdf / label) — NO Component references — so section
// files can import exhibitLabelOf/pageNumOf from here without a circular dependency (DeckShell attaches the
// Components). kind: 'exhibit' → lettered; 'appendix' → romaned; 'title' → no label (cover + Deal Summary).

export const DECK_ORDER = [
  // Screen-only lead slide (showInPdf:false, like the Dashboard) — the PDF still starts at `title`
  // and stays 17 pages, so adding this changed no exported page and no rendered figure.
  { id: 'execsummary',   kind: 'title',    showInPdf: false, label: 'Executive Summary' },
  { id: 'dashboard',     kind: 'title',    showInPdf: false, label: 'Deal Summary' },
  { id: 'title',         kind: 'title',    showInPdf: true,  label: 'Title' },
  { id: 'comparables',   kind: 'exhibit',  showInPdf: true,  label: 'Comparables' },
  { id: 'profiles',      kind: 'exhibit',  showInPdf: true,  label: 'Company Profiles' },
  { id: 'targetprofile', kind: 'exhibit',  showInPdf: true,  label: 'Target Profile' },
  { id: 'shareholders',  kind: 'exhibit',  showInPdf: true,  label: 'Shareholder Analysis' },
  { id: 'plAcquirer',    kind: 'exhibit',  showInPdf: true,  label: 'Standalone P&L — Acquirer' },
  { id: 'plTarget',      kind: 'exhibit',  showInPdf: true,  label: 'Standalone P&L — Target' },
  { id: 'proforma',      kind: 'exhibit',  showInPdf: true,  label: 'Pro Forma & Accretion' },
  { id: 'txnstructure',  kind: 'exhibit',  showInPdf: true,  label: 'Transaction Structure' },
  { id: 'privatevaluation', kind: 'exhibit', showInPdf: true, label: 'Private Company Valuation' }, // Phase 9 — shown for private deals only (DeckShell)
  { id: 'creditstats',   kind: 'exhibit',  showInPdf: true,  label: 'Pro-Forma Credit Stats' },   // Phase 8 — shown for private deals only (DeckShell)
  { id: 'exchange',      kind: 'exhibit',  showInPdf: true,  label: 'Exchange Ratio & Deal Terms' },
  { id: 'exchangeratio', kind: 'exhibit',  showInPdf: true,  label: 'Exchange Ratio Analysis' },
  { id: 'equity',        kind: 'exhibit',  showInPdf: true,  label: 'Equity Performance' },
  { id: 'contribution',  kind: 'exhibit',  showInPdf: true,  label: 'Relative Contribution' },
  { id: 'analyst',       kind: 'exhibit',  showInPdf: true,  label: 'Analyst Consensus' },
  { id: 'sources',       kind: 'appendix', showInPdf: true,  label: 'Sources & Methodology' },
  { id: 'verification',  kind: 'appendix', showInPdf: true,  label: 'Data Verification' },
  { id: 'verification2', kind: 'appendix', showInPdf: true,  label: 'Data Verification (cont.)' },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// Walk the PDF sections in order: assign exhibit letters, appendix romans, and 1-based page numbers.
function computeMaps(order) {
  const LABEL = {}, PAGE = {};
  let ex = 0, ap = 0, pg = 0;
  for (const s of order) {
    if (!s.showInPdf) continue;
    PAGE[s.id] = ++pg;
    if (s.kind === 'exhibit') LABEL[s.id] = `Exhibit ${String.fromCharCode(65 + ex++)}`;
    else if (s.kind === 'appendix') LABEL[s.id] = `Appendix ${ROMAN[ap++]}`;
    // 'title' → no exhibit/appendix label
  }
  return { LABEL, PAGE };
}

// Active maps are RECOMPUTABLE so §8 private-mode suppression renumbers every exhibit letter, appendix
// roman, page number AND prose cross-ref together — the "hardcoded Exhibit I goes stale when a section is
// removed" class of bug. Default = the full deck. DeckShell calls setActiveSections(visibleIds) at the top
// of its render (before any exhibitLabelOf/pageNumOf runs this frame) whenever the deck is suppressed.
let _maps = computeMaps(DECK_ORDER);
export function setActiveSections(keepIds) {
  const keep = new Set(keepIds);
  _maps = computeMaps(DECK_ORDER.filter(s => keep.has(s.id)));
}
export function resetActiveSections() { _maps = computeMaps(DECK_ORDER); }

// "Exhibit A" | "Appendix I" | null (title). Used both for a section's OWN label (threaded by DeckShell) and
// for prose cross-refs to ANOTHER section (imported directly by section files). Reflects the active set.
export const exhibitLabelOf = (id) => _maps.LABEL[id] || null;

// 1-based PDF page number, or null for non-PDF. Serves the rendered "§N" prose cross-refs.
export const pageNumOf = (id) => _maps.PAGE[id] || null;
