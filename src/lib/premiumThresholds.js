// Cash structure threshold bands for the 19.9% NYSE/Nasdaq shareholder vote rule.
// stockIssuancePct is the % of acquirer pre-deal shares being issued as deal consideration.

export const CASH_BANDS = [
  { minCash: 80.1, label: 'All-cash dominant',   color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
  { minCash: 50,   label: 'Cash-majority',        color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  { minCash: 19.9, label: 'Stock-majority',       color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  { minCash: 0,    label: 'Mostly stock',         color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
];

export function getCashBand(cashPercent) {
  for (const band of CASH_BANDS) {
    if (cashPercent >= band.minCash) return band;
  }
  return CASH_BANDS[CASH_BANDS.length - 1];
}

// stockIssuancePct thresholds (as % of acquirer pre-deal shares)
export const ISSUANCE_VOTE_THRESHOLD = 19.9;  // NYSE §312.03 / Nasdaq Rule 5635
export const ISSUANCE_MAJORITY_THRESHOLD = 50; // majority-stock deal — heightened scrutiny
