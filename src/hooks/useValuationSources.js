import { useState, useEffect } from 'react';

const API = 'http://localhost:3001';

const median = (arr) => {
  const a = (arr || []).filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// Fetch the three app-built valuation methodologies for a ticker:
//   • /api/dcf             — transparent, app-built DCF (visible assumptions, NOT FMP's black-box value)
//   • /api/analyst-targets — deduped latest-per-firm sell-side panel (recency + outlier filtered)
//   • /api/sector-multiple — sector-median EV/Revenue from the ACTUAL peer set
// Each is graceful: null on any failure, so a missing methodology simply drops from the football field
// (no fabricated placeholder). Precedent SaaS M&A is deliberately OMITTED everywhere (unsourceable).
// canonicalShares (RAW shares) is optional: when supplied it is passed to /api/dcf so the DCF per-share
// value uses the SAME diluted count as the rest of the deck (EDGAR diluted) instead of re-deriving its own.
export function useValuationSources(ticker, canonicalShares) {
  const [dcf, setDcf] = useState(null);
  const [analyst, setAnalyst] = useState(null);
  const [sector, setSector] = useState(null);

  useEffect(() => {
    if (!ticker) { setDcf(null); setAnalyst(null); setSector(null); return; }
    let cancel = false;
    const grab = (path, set, qs) =>
      fetch(`${API}${path}/${ticker}${qs || ''}`)
        .then(r => r.json())
        .then(d => { if (!cancel) set(d); })
        .catch(() => { if (!cancel) set(null); });
    const dcfQs = (Number.isFinite(canonicalShares) && canonicalShares > 0) ? `?shares=${Math.round(canonicalShares)}` : '';
    grab('/api/dcf', setDcf, dcfQs);
    grab('/api/analyst-targets', setAnalyst);
    grab('/api/sector-multiple', setSector);
    return () => { cancel = true; };
  }, [ticker, canonicalShares]);

  return { dcf, analyst, sector };
}

// Shared "robust panel" predicate — the deck's ONE definition of an analyst panel big enough to headline a
// median. Reuses §13's existing bar: a real panel is ≥3 firms ("not one stray broker"). §12 ref,
// buildMethodologyRows (§12 bar + §14 mid), §16 reconcile, and §13 (via hasBankData) all gate on THIS, so
// every slide treats a thin panel identically. Below the bar the figure is still SHOWN — just labeled thin,
// never forced into a fake-robust median. `analyst` is the /api/analyst-targets payload ({ ok, count, … }).
export const ROBUST_PANEL_MIN = 3;
export function isRobustPanel(analyst) {
  return !!(analyst && analyst.ok && analyst.count >= ROBUST_PANEL_MIN);
}

// Assemble methodology rows (low/mid/high per method) from the fetched sources + the real 52-week range.
// Order is deliberate: market range → analyst → DCF → sector. Only methodologies with real data appear.
// `priceRange` is the caller-computed 52-week row ({low, high, note}) so the football field reuses the
// verified/CNBC range (or its honest monthly-close fallback) that already lives on the slide.
export function buildMethodologyRows({ priceRange, analyst, dcf, sector }) {
  const rows = [];

  if (priceRange && priceRange.low != null && priceRange.high != null) {
    rows.push({
      key: '52wk', name: '52-Week Trading Range', kind: 'market',
      low: priceRange.low, high: priceRange.high, mid: (priceRange.low + priceRange.high) / 2,
      note: priceRange.note || '52-week trading range',
    });
  }

  if (analyst && analyst.ok && analyst.low != null && analyst.high != null) {
    // Robust panel (≥3) → median headline, unchanged. Thin panel (1–2) → STILL show the row/bar (reader
    // sees the figure) but tag it "thin (N=…)" so its unreliability travels with it — no dropped row, no
    // silent fake-robust headline. (analyst.ok=false / N=0 never reaches here → row omitted, as before.)
    rows.push({
      key: 'analyst', name: 'Analyst Price Targets', kind: 'analyst',
      low: analyst.low, high: analyst.high, mid: analyst.median != null ? analyst.median : analyst.mean,
      note: isRobustPanel(analyst)
        ? `${analyst.count}-firm deduped panel · median ${analyst.median != null ? `$${analyst.median.toFixed(0)}` : '—'}`
        : `thin (N=${analyst.count}) · ${analyst.count}-firm panel · indicative, not robust`,
    });
  }

  if (dcf && dcf.ok && dcf.low != null && dcf.high != null) {
    const a = dcf.assumptions || {};
    rows.push({
      key: 'dcf', name: 'Discounted Cash Flow', kind: 'dcf',
      low: dcf.low, high: dcf.high, mid: dcf.perShare,
      note: `App-built · WACC ${a.waccPct}% · growth ${a.nearTermGrowthPct}%→${a.terminalGrowthPct}% terminal`,
    });
  }

  // Sector-median EV/Revenue — GATED like the DCF (which excludes negative-equity). A peer-median multiple
  // applied to a company that trades far from the sector (RRGB: a 2.01x sector median on a stock trading at
  // ~0.5x EV/Rev → $104.73 vs a real ~$8) yields an implausible per-share that would drag the blend. Exclude
  // it from rows (→ blend + chart) when it is an OUTLIER vs the other methods (>3x or <1/3 their median) or
  // the implied value is non-positive; the caller renders the ref row as n/m + reason. Valid cases (CRM/TEAM,
  // in line with analyst/price) pass through unchanged.
  if (sector && sector.ok && sector.low != null && sector.high != null) {
    const ref = median(rows.map((r) => r.mid).filter((v) => v != null && v > 0));
    const implied = sector.impliedPerShare;
    const outlier = implied == null || implied <= 0 ||
      (ref != null && ref > 0 && (implied > 3 * ref || implied < ref / 3));
    if (!outlier) {
      rows.push({
        key: 'sector', name: 'Sector-Median EV / Revenue', kind: 'sector',
        low: sector.low, high: sector.high, mid: sector.impliedPerShare,
        note: `${sector.medianEvToSales}x median across ${(sector.peerMultiples || []).length} peers`,
      });
    }
    // else: excluded — not pushed → out of blend + chart; the caller shows the ref row as n/m.
  }

  return rows;
}
