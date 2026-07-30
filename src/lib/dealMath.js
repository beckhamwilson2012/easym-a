export function calcStockIssuancePct({ dealSize, cashPercent, acquirerSharePrice, acquirerSharesOutstanding }) {
  if (!(acquirerSharePrice > 0) || !(acquirerSharesOutstanding > 0)) return null;
  const stockConsideration = dealSize * (1 - cashPercent / 100);
  const newSharesIssued = stockConsideration / acquirerSharePrice;
  return (newSharesIssued / acquirerSharesOutstanding) * 100;
}

export function triggers199Rule(stockIssuancePct) {
  if (stockIssuancePct == null) return false;
  return stockIssuancePct >= 19.9;
}
