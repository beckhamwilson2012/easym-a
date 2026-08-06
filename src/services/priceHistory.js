import { apiUrl } from '../api';
export async function getMonthlyPrices(ticker) {
  if (!ticker) return { source: 'illustrative', series: [] };
  try {
    const res = await fetch(apiUrl(`/api/prices/${encodeURIComponent(ticker)}`));
    return await res.json();
  } catch {
    return { source: 'illustrative', series: [] };
  }
}
