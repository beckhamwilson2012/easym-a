export async function getMonthlyPrices(ticker) {
  if (!ticker) return { source: 'illustrative', series: [] };
  try {
    const res = await fetch(`http://localhost:3001/api/prices/${encodeURIComponent(ticker)}`);
    return await res.json();
  } catch {
    return { source: 'illustrative', series: [] };
  }
}
