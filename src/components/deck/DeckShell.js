import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import { buildDeckModel } from '../../lib/deckModel';

import { DeckToolbar } from './DeckToolbar';
import { SF_BLUE } from './shared/deckTokens';
import { SectionExecutiveSummary } from './sections/SectionExecutiveSummary';
import { SectionDashboard }        from './sections/SectionDashboard';
import { SectionTitlePage }        from './sections/SectionTitlePage';
import { SectionComparables }      from './sections/SectionComparables';
import { SectionCompanyProfiles }  from './sections/SectionCompanyProfiles';
import { SectionTargetOverview }    from './sections/SectionTargetOverview';
import { SectionShareholderAnalysis } from './sections/SectionShareholderAnalysis';
import { SectionStandalonePLAcquirer, SectionStandalonePLTarget } from './sections/SectionStandalonePL';
import { SectionProFormaPLA } from './sections/SectionProFormaPL';
import { SectionTransactionStructure } from './sections/SectionTransactionStructure';
import { SectionExchangeRatio }     from './sections/SectionExchangeRatio';
import { SectionExchangeRatioAnalysis } from './sections/SectionExchangeRatioAnalysis';
import { SectionPricePerformance } from './sections/SectionPricePerformance';
import { SectionRelativeContribution } from './sections/SectionRelativeContribution';
import { SectionAnalystConsensus } from './sections/SectionAnalystConsensus';
import { SectionCreditStats } from './sections/SectionCreditStats';
import { SectionPrivateValuation } from './sections/SectionPrivateValuation';
import { SectionSources }          from './sections/SectionSources';
import { SectionDataVerificationA, SectionDataVerificationB } from './sections/SectionDataVerification';
import { DECK_ORDER, exhibitLabelOf, setActiveSections } from './deckRegistry';

// Order: §10 Trading Profile dropped; old §12 Football Field + §14 Valuation Matrix were merged into one
// Valuation Summary (Exhibit N), which has since been REMOVED — the app-built DCF and sector-median
// EV/Revenue it displayed are no longer part of the deck (Exhibit sequence now ends at M · Analyst
// Consensus; Sources → App I, Data Verification → App II/III). Pro Forma & Accretion is one logical exhibit
// split across two pages — E (detailed per-year tables) + F (accretion, the old §7 Forward Accretion folded
// in; SectionForwardAccretion retired). Dashboard is internal (non-PDF) first; the two Data Verification
// appendices last. 17 PDF slides.
// Component wiring — the ORDER, kind, labels + derived exhibit letters / page numbers all live in
// deckRegistry (single source; it holds NO Component refs so section files can import exhibitLabelOf/
// pageNumOf without a cycle). Here we only attach each id's Component to the registry order.
const COMPONENTS = {
  execsummary: SectionExecutiveSummary,
  dashboard: SectionDashboard, title: SectionTitlePage, comparables: SectionComparables,
  profiles: SectionCompanyProfiles, targetprofile: SectionTargetOverview, shareholders: SectionShareholderAnalysis,
  plAcquirer: SectionStandalonePLAcquirer, plTarget: SectionStandalonePLTarget, proforma: SectionProFormaPLA,
  txnstructure: SectionTransactionStructure, privatevaluation: SectionPrivateValuation, creditstats: SectionCreditStats, exchange: SectionExchangeRatio, exchangeratio: SectionExchangeRatioAnalysis,
  equity: SectionPricePerformance, contribution: SectionRelativeContribution, analyst: SectionAnalystConsensus,
  sources: SectionSources, verification: SectionDataVerificationA, verification2: SectionDataVerificationB,
};
const SECTIONS = DECK_ORDER.map(s => ({ ...s, Component: COMPONENTS[s.id] }));

// pageNum for each showInPdf section (1-indexed)
const PDF_SECTIONS = SECTIONS.filter(s => s.showInPdf);
const PAGE_NUM_MAP = Object.fromEntries(PDF_SECTIONS.map((s, i) => [s.id, i + 1]));

export function DeckShell({ target, acquirer, deal, comparables, onEditInputs, onNewAnalysis, onSaveAnalysis }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [exporting, setExporting]     = useState(false);
  const hiddenRef = useRef(null);

  // ── Phase 8 — private-mode section suppression ──────────────────────────────────────────────────────
  // When the deal has no market data (a private company), drop the market-data exhibits and RENUMBER: the
  // suppressed set is Equity Performance + stock-price distribution (equity), Analyst Consensus (analyst),
  // and the share-price-based Exchange Ratio Analysis (exchangeratio). setActiveSections recomputes every
  // exhibit letter / page number / prose cross-ref over the visible set (closes the stale-"Exhibit I" bug).
  // Public decks: hasMarketData !== false → nothing suppressed, byte-identical to before.
  const SUPPRESS_PRIVATE = new Set(['equity', 'analyst', 'exchangeratio']);
  const PRIVATE_ONLY = new Set(['privatevaluation', 'creditstats']);   // Phase 8/9 exhibits — private decks only
  const hasMarketData = deal ? deal.hasMarketData !== false : true;
  let activeSections;
  if (hasMarketData) {
    activeSections = SECTIONS.filter(s => !PRIVATE_ONLY.has(s.id));   // public: no private valuation / credit-stats exhibits (deck unchanged)
  } else {
    // private: drop the market-data exhibits, KEEP Private Valuation + Pro-Forma Credit Stats, and PROMOTE the
    // Private Valuation then Relative Contribution to the headline slots (right after the Title) — the derived
    // valuation and the ownership/contribution split lead a private deck. Both moves recompute exhibit letters.
    const kept = SECTIONS.filter(s => !SUPPRESS_PRIVATE.has(s.id));
    const titleIdx = kept.findIndex(s => s.id === 'title');
    if (titleIdx >= 0) {
      const rest = kept.filter(s => s.id !== 'contribution' && s.id !== 'privatevaluation');
      const ti = rest.findIndex(s => s.id === 'title');
      const promote = ['privatevaluation', 'contribution']
        .map(id => kept.find(s => s.id === id))
        .filter(Boolean);
      rest.splice(ti + 1, 0, ...promote);   // Title → Private Valuation → Relative Contribution → …
      activeSections = rest;
    } else activeSections = kept;
  }
  const activePdfSections = activeSections.filter(s => s.showInPdf);
  const activePageNumMap = Object.fromEntries(activePdfSections.map((s, i) => [s.id, i + 1]));
  setActiveSections(activePdfSections.map(s => s.id));   // renumber labels over the visible set (synchronous, before children render)

  // Keyboard navigation — plain one-step advance/retreat, clamped to the active set.
  // (The old `if (i === 0) return 1; // Dashboard → Title` special case was removed: at i=0 it
  // returned exactly what Math.min(i + 1, len - 1) returns for any len >= 2, so it was already
  // redundant, and its "Dashboard → Title" comment went stale once a slide was inserted ahead of
  // the Dashboard. Dropping it also removes the single-section out-of-bounds edge it carried.)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight') {
        setActiveIndex(i => Math.min(i + 1, activeSections.length - 1));
      }
      if (e.key === 'ArrowLeft') {
        setActiveIndex(i => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // PDF export — only sections with showInPdf: true
  const handleExport = useCallback(async () => {
    if (!hiddenRef.current || exporting) return;
    setExporting(true);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      const pageW = 612;
      const pageH = 792;

      for (let i = 0; i < activePdfSections.length; i++) {
        const node = hiddenRef.current.querySelector(`[data-section-id="${activePdfSections[i].id}"]`);
        if (!node) continue;
        // scale 1.5 (≈918px/letter-page — plenty for the data tables) + JPEG q0.85 keeps text crisp while
        // cutting file size ~20× vs. PNG@2. The white deck background compresses cleanly with no visible loss.
        const canvas = await html2canvas(node, {
          scale: 1.5, backgroundColor: '#ffffff', useCORS: true, logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        // Fit-to-page: a section taller than the page scales down UNIFORMLY (aspect ratio preserved,
        // centered with side margins) instead of being squished vertically. Only bites when the natural
        // height exceeds the page (the dense §8 pro-forma page today); every shorter page is unchanged.
        let drawW = pageW;
        let drawH = (canvas.height / canvas.width) * pageW;
        if (drawH > pageH) { const s = pageH / drawH; drawW *= s; drawH = pageH; }
        const xOffset = (pageW - drawW) / 2;
        const yOffset = (pageH - drawH) / 2;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', xOffset, yOffset, drawW, drawH);
      }

      const ticker = target.ticker || target.name || 'Target';
      pdf.save(`${ticker.replace(/\s+/g, '_')}_MA_Deck.pdf`);
    } finally {
      setExporting(false);
    }
  }, [exporting, target]);

  const activeSection = activeSections[Math.min(activeIndex, activeSections.length - 1)];
  const ActiveComponent = activeSection.Component;
  const activePdfPageNum = activePageNumMap[activeSection.id] ?? null;
  const isDash = activeSection.id === 'dashboard';

  // Option-B on-screen enlargement: the VISIBLE PageFrame slide is scaled up ~1.15× for readability. The
  // scale lives on the on-screen wrapper ONLY — the hidden PDF render tree (hiddenRef) is never scaled, so
  // PageFrame is captured at its physical 850px and the PDF output is unchanged. The Dashboard (not a
  // PageFrame slide) renders unscaled at its own fluid width.
  const SLIDE_SCALE = 1.15;
  const scale = isDash ? 1 : SLIDE_SCALE;

  // Measure the slide's UNSCALED height (offsetHeight ignores the transform) so the layout wrapper reserves
  // the extra ~15% visual footprint — otherwise the scaled slide would clip / overlap the Prev-Next row.
  const slideRef = useRef(null);
  const [slideH, setSlideH] = useState(0);
  useLayoutEffect(() => {
    const el = slideRef.current;
    if (!el) { setSlideH(0); return; }
    const measure = () => setSlideH(el.offsetHeight);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [activeIndex]);

  // C1 — single source of truth. Built once from the props and handed to every section so no slide
  // re-derives a shared number (market cap, offer, ownership, shares, accretion) locally.
  const model = useMemo(() => buildDeckModel({ target, acquirer, deal }), [target, acquirer, deal]);

  const sectionProps = { target, acquirer, deal, comparables, model, onEditInputs, onNewAnalysis, onSaveAnalysis };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      {/* Sticky toolbar */}
      <DeckToolbar target={target} acquirer={acquirer} onExport={handleExport} exporting={exporting} />

      {/* Body: always-visible left rail | slide content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left sidebar — vertical section rail. Reuses the SAME SECTIONS + activeIndex + setActiveIndex the
            old DeckTabBar used (no parallel nav logic). Vertical stacking removes the horizontal overflow. */}
        <nav style={{ width: 232, flexShrink: 0, background: '#fff', borderRight: '1px solid #E5E7EB', overflowY: 'auto', paddingTop: 4 }}>
          {activeSections.map((section, i) => {
            const isActive = i === activeIndex;
            // Rail badge = the PDF PAGE NUMBER, not the array index. The two coincided only while
            // `dashboard` was the single non-PDF section at index 0 (title i=1 = page 1 ... i=17 =
            // page 17); inserting another non-PDF slide ahead of it breaks that, so read the page
            // map directly. Non-PDF sections have no page and render the bullet.
            const badge = activePageNumMap[section.id];
            return (
              <button
                key={section.id}
                onClick={() => setActiveIndex(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '8px 12px 8px 9px', border: 'none',
                  borderLeft: isActive ? `3px solid ${SF_BLUE}` : '3px solid transparent',
                  background: isActive ? '#EFF6FF' : 'transparent', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F3F4F6'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                  background: isActive ? SF_BLUE : '#E5E7EB',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: badge == null ? 13 : 9, fontWeight: 700,
                  color: isActive ? '#fff' : '#6B7280', lineHeight: 1,
                }}>
                  {badge ?? '•'}
                </span>
                <span style={{ fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? SF_BLUE : '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {section.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Slide content area — scrolls independently of the rail; slide centered WITH margin. */}
        <div style={{ flex: 1, overflow: 'auto', background: '#F4F6F9', padding: '32px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {isDash ? (
              <div style={{ width: '100%', maxWidth: 1200 }}>
                <ActiveComponent {...sectionProps} pageNum={activePdfPageNum} exhibitLabel={exhibitLabelOf(activeSection.id)} />
              </div>
            ) : (
              // The layout box reserves the SCALED footprint (width & height) so the transform never clips or
              // bleeds into the sidebar / Prev-Next. Inner (slideRef) is the physical 850px slide; the hidden
              // PDF tree is a SEPARATE, un-scaled render — PageFrame stays 850 for capture (PDF unchanged).
              <div style={{ width: 850 * scale, height: slideH ? slideH * scale : undefined, flexShrink: 0 }}>
                <div ref={slideRef} style={{ width: 850, margin: '0 auto', transform: `scale(${scale})`, transformOrigin: 'top center' }}>
                  <ActiveComponent {...sectionProps} pageNum={activePdfPageNum} exhibitLabel={exhibitLabelOf(activeSection.id)} />
                </div>
              </div>
            )}
          </div>

          {/* Prev / Next navigation */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
            <button
              onClick={() => setActiveIndex(i => Math.max(i - 1, 0))}
              disabled={activeIndex === 0}
              style={{
                padding: '8px 20px', borderRadius: 6, border: '1px solid #D1D5DB',
                background: '#fff', color: activeIndex === 0 ? '#D1D5DB' : '#374151',
                cursor: activeIndex === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              ← Previous
            </button>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: '#6B7280' }}>
              {activeIndex + 1} / {activeSections.length}
            </span>
            <button
              onClick={() => setActiveIndex(i => Math.min(i + 1, activeSections.length - 1))}
              disabled={activeIndex === activeSections.length - 1}
              style={{
                padding: '8px 20px', borderRadius: 6, border: '1px solid #D1D5DB',
                background: '#fff', color: activeIndex === activeSections.length - 1 ? '#D1D5DB' : '#374151',
                cursor: activeIndex === activeSections.length - 1 ? 'default' : 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Hidden offscreen container — only showInPdf sections, for PDF capture */}
      <div
        ref={hiddenRef}
        style={{ position: 'absolute', left: -10000, top: 0, pointerEvents: 'none', zIndex: -1 }}
        aria-hidden="true"
      >
        {activePdfSections.map((section, i) => (
          <div key={section.id} data-section-id={section.id} style={{ marginBottom: 4 }}>
            <section.Component {...sectionProps} pageNum={i + 1} exhibitLabel={exhibitLabelOf(section.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
