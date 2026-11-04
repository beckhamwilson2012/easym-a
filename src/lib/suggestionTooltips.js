// ── Tooltip builders ──────────────────────────────────────────────────────────

export function buildCashPercentTooltip(isBank = false) {
  const defaultCash = isBank ? 80 : 60;
  const defaultStock = 100 - defaultCash;
  return {
    formula: 'Heuristic default — adjust to reflect deal-specific financing capacity and acquirer share price',
    inputs: [
      { label: 'Suggested cash component', value: `${defaultCash}%` },
      { label: 'Suggested stock component', value: `${defaultStock}%` },
      { label: '19.9% threshold (NYSE §312.03 / Nasdaq Rule 5635)', value: 'Stock issuance ≥ 19.9% of acquirer shares → shareholder vote required' },
      { label: 'Majority-stock trigger', value: 'Stock issuance ≥ 50% of acquirer shares → heightened scrutiny' },
    ],
    result: `${defaultCash}% cash / ${defaultStock}% stock`,
    notes: 'The median cash share across completed US M&A from 2010 to 2024 falls between 55% and 65%. NYSE Rule §312.03 and Nasdaq Rule 5635 require an acquirer shareholder vote whenever the stock issued exceeds 19.9% of pre-deal shares outstanding — a common deal constraint. All-cash deals are more frequent in private-target deals; all-stock deals signal the acquirer believes its own equity is overvalued.'
      + (isBank ? ' Bank regulators apply additional scrutiny to stock-heavy deals that dilute Tier 1 capital ratios — acquirers with CET1 below 10% typically prefer cash or hybrid structures.' : ''),
    sources: ['Refinitiv US M&A Review', 'NYSE Listed Company Manual §312.03', 'Nasdaq Rule 5635'],
  };
}
