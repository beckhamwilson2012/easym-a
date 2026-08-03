import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import { buildDeckModel } from '../../lib/deckModel';

import { DeckToolbar } from './DeckToolbar';
import { SF_BLUE } from './shared/deckTokens';
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
import { SectionPricePerformance } from './sections/SectionPricePerformance';
import { SectionRelativeContribution } from './sections/SectionRelativeContribution';
import { SectionAnalystConsensus } from './sections/SectionAnalystConsensus';
import { SectionSources }          from './sections/SectionSources';
import { SectionDataVerificationA, SectionDataVerificationB } from './sections/SectionDataVerification';

// Order: §10 Trading Profile dropped; old §12 Football Field + §14 Valuation Matrix were merged into one
// Valuation Summary (Exhibit N), which has since been REMOVED — the app-built DCF and sector-median
// EV/Revenue it displayed are no longer part of the deck (Exhibit sequence now ends at M · Analyst
// Consensus; Sources → App I, Data Verification → App II/III). Pro Forma & Accretion is one logical exhibit
// split across two pages — E (detailed per-year tables) + F (accretion, the old §7 Forward Accretion folded
// in; SectionForwardAccretion retired). Dashboard is internal (non-PDF) first; the two Data Verification
// appendices last. 17 PDF slides.
const SECTIONS = [
  { id: 'dashboard',    label: 'Deal Summary',                Component: SectionDashboard,            showInPdf: false },
  { id: 'title',        label: 'Title',                       Component: SectionTitlePage,            showInPdf: true  }, // 1
  { id: 'comparables',  label: 'Comparables',                 Component: SectionComparables,          showInPdf: true  }, // 2  · Exhibit A
  { id: 'profiles',     label: 'Company Profiles',            Component: SectionCompanyProfiles,      showInPdf: true  }, // 3  · Exhibit B
  { id: 'targetprofile',label: 'Target Profile',              Component: SectionTargetOverview,       showInPdf: true  }, // 4  · Exhibit C  (data-driven target deep-dive: segments/metrics/trend — any ticker, real data)
  { id: 'shareholders', label: 'Shareholder Analysis',        Component: SectionShareholderAnalysis,  showInPdf: true  }, // 5  · Exhibit D  (DEF 14A beneficial ownership: self-validating parse OR FMP fallback — target-side)
  { id: 'plAcquirer',   label: 'Standalone P&L — Acquirer',   Component: SectionStandalonePLAcquirer, showInPdf: true  }, // 6  · Exhibit E
  { id: 'plTarget',     label: 'Standalone P&L — Target',     Component: SectionStandalonePLTarget,   showInPdf: true  }, // 7  · Exhibit F
  { id: 'proforma',     label: 'Pro Forma & Accretion',       Component: SectionProFormaPLA,          showInPdf: true  }, // 8  · Exhibit G  (per-year P&L + accretion strip; §9 folded on, 7E)
  { id: 'txnstructure', label: 'Transaction Structure',       Component: SectionTransactionStructure, showInPdf: true  }, // 9  · Exhibit H  (Sources & Uses + pro-forma cap)
  { id: 'exchange',     label: 'Exchange Ratio & Deal Terms', Component: SectionExchangeRatio,        showInPdf: true  }, // 10 · Exhibit I
  { id: 'equity',       label: 'Equity Performance',          Component: SectionPricePerformance,     showInPdf: true  }, // 11 · Exhibit J
  { id: 'contribution', label: 'Relative Contribution',       Component: SectionRelativeContribution, showInPdf: true  }, // 12 · Exhibit K
  { id: 'analyst',      label: 'Analyst Consensus',           Component: SectionAnalystConsensus,     showInPdf: true  }, // 13 · Exhibit L
  { id: 'sources',      label: 'Sources & Methodology',       Component: SectionSources,              showInPdf: true  }, // 15 · Appendix I
  { id: 'verification', label: 'Data Verification',           Component: SectionDataVerificationA,    showInPdf: true  }, // 16 · Appendix II  (Market/Shares/Income)
  { id: 'verification2',label: 'Data Verification (cont.)',   Component: SectionDataVerificationB,    showInPdf: true  }, // 17 · Appendix III (Balance/CashFlow/Analyst/Ratings)
];

// pageNum for each showInPdf section (1-indexed)
const PDF_SECTIONS = SECTIONS.filter(s => s.showInPdf);
const PAGE_NUM_MAP = Object.fromEntries(PDF_SECTIONS.map((s, i) => [s.id, i + 1]));

export function DeckShell({ target, acquirer, deal, comparables, onEditInputs, onNewAnalysis, onSaveAnalysis }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [exporting, setExporting]     = useState(false);
  const hiddenRef = useRef(null);

  // Keyboard navigation — arrow right from Dashboard goes directly to Title (index 1)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight') {
        setActiveIndex(i => {
          if (i === 0) return 1; // Dashboard → Title
          return Math.min(i + 1, SECTIONS.length - 1);
        });
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

      for (let i = 0; i < PDF_SECTIONS.length; i++) {
        const node = hiddenRef.current.querySelector(`[data-section-id="${PDF_SECTIONS[i].id}"]`);
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

  const activeSection = SECTIONS[activeIndex];
  const ActiveComponent = activeSection.Component;
  const activePdfPageNum = PAGE_NUM_MAP[activeSection.id] ?? null;
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
          {SECTIONS.map((section, i) => {
            const isActive = i === activeIndex;
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
                  fontSize: section.id === 'dashboard' ? 13 : 9, fontWeight: 700,
                  color: isActive ? '#fff' : '#6B7280', lineHeight: 1,
                }}>
                  {section.id === 'dashboard' ? '•' : i}
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
                <ActiveComponent {...sectionProps} pageNum={activePdfPageNum} />
              </div>
            ) : (
              // The layout box reserves the SCALED footprint (width & height) so the transform never clips or
              // bleeds into the sidebar / Prev-Next. Inner (slideRef) is the physical 850px slide; the hidden
              // PDF tree is a SEPARATE, un-scaled render — PageFrame stays 850 for capture (PDF unchanged).
              <div style={{ width: 850 * scale, height: slideH ? slideH * scale : undefined, flexShrink: 0 }}>
                <div ref={slideRef} style={{ width: 850, margin: '0 auto', transform: `scale(${scale})`, transformOrigin: 'top center' }}>
                  <ActiveComponent {...sectionProps} pageNum={activePdfPageNum} />
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
              {activeIndex + 1} / {SECTIONS.length}
            </span>
            <button
              onClick={() => setActiveIndex(i => Math.min(i + 1, SECTIONS.length - 1))}
              disabled={activeIndex === SECTIONS.length - 1}
              style={{
                padding: '8px 20px', borderRadius: 6, border: '1px solid #D1D5DB',
                background: '#fff', color: activeIndex === SECTIONS.length - 1 ? '#D1D5DB' : '#374151',
                cursor: activeIndex === SECTIONS.length - 1 ? 'default' : 'pointer', fontSize: 13, fontWeight: 500,
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
        {PDF_SECTIONS.map((section, i) => (
          <div key={section.id} data-section-id={section.id} style={{ marginBottom: 4 }}>
            <section.Component {...sectionProps} pageNum={i + 1} />
          </div>
        ))}
      </div>
    </div>
  );
}
