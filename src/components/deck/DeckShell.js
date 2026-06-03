import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

import { DeckToolbar } from './DeckToolbar';
import { DeckTabBar }  from './DeckTabBar';
import { SectionDashboard }        from './sections/SectionDashboard';
import { SectionTitlePage }        from './sections/SectionTitlePage';
import { SectionComparables }      from './sections/SectionComparables';
import { SectionBriefingCover }    from './sections/SectionBriefingCover';
import { SectionTargetOverview }   from './sections/SectionTargetOverview';
import { SectionPricePerformance } from './sections/SectionPricePerformance';
import { SectionFootballField }    from './sections/SectionFootballField';
import { SectionStandalonePL }     from './sections/SectionStandalonePL';
import { SectionAVP }              from './sections/SectionAVP';
import { SectionSynergyOverview }  from './sections/SectionSynergyOverview';
import { SectionProFormaPL }       from './sections/SectionProFormaPL';
import { SectionStrategicRationale } from './sections/SectionStrategicRationale';
import { SectionDataVerification }   from './sections/SectionDataVerification';

const SECTIONS = [
  { id: 'dashboard',   label: 'Dashboard',           Component: SectionDashboard,          showInPdf: false },
  { id: 'title',       label: 'Title',               Component: SectionTitlePage,          showInPdf: true  },
  { id: 'comparables', label: 'Comparables',         Component: SectionComparables,        showInPdf: true  },
  { id: 'briefing',    label: 'Target Briefing',     Component: SectionBriefingCover,      showInPdf: true  },
  { id: 'overview',    label: 'Target Overview',     Component: SectionTargetOverview,     showInPdf: true  },
  { id: 'price',       label: 'Price Performance',   Component: SectionPricePerformance,   showInPdf: true  },
  { id: 'football',    label: 'Football Field',       Component: SectionFootballField,      showInPdf: true  },
  { id: 'pl',          label: 'Standalone P&L',      Component: SectionStandalonePL,       showInPdf: true  },
  { id: 'avp',         label: 'Valuation (AVP)',     Component: SectionAVP,                showInPdf: true  },
  { id: 'synergy',     label: 'Synergy Overview',    Component: SectionSynergyOverview,    showInPdf: true  },
  { id: 'proforma',    label: 'Pro Forma P&L',       Component: SectionProFormaPL,         showInPdf: true  },
  { id: 'rationale',   label: 'Strategic Rationale', Component: SectionStrategicRationale, showInPdf: true  },
  { id: 'verification', label: 'Data Verification',  Component: SectionDataVerification,   showInPdf: true  },
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
        const canvas = await html2canvas(node, {
          scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        });
        const imgData = canvas.toDataURL('image/png');
        const imgW = pageW;
        const imgH = (canvas.height / canvas.width) * pageW;
        const yOffset = imgH < pageH ? (pageH - imgH) / 2 : 0;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, yOffset, imgW, Math.min(imgH, pageH));
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
  const maxWidth = activeSection.id === 'dashboard' ? 1200 : 850;

  const sectionProps = { target, acquirer, deal, comparables, onEditInputs, onNewAnalysis, onSaveAnalysis };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      {/* Sticky toolbar */}
      <DeckToolbar target={target} acquirer={acquirer} onExport={handleExport} exporting={exporting} />

      {/* Sticky tab bar */}
      <div style={{ position: 'sticky', top: 56, zIndex: 19, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
        <DeckTabBar sections={SECTIONS} activeIndex={activeIndex} onSelect={setActiveIndex} />
      </div>

      {/* Scrollable section area */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#F4F6F9', padding: '32px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth }}>
            <ActiveComponent {...sectionProps} pageNum={activePdfPageNum} />
          </div>
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
