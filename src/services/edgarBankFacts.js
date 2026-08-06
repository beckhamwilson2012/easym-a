import { apiUrl } from '../api';
export async function getBankFacts(ticker) {
  if (!ticker) return null;
  try {
    const res = await fetch(apiUrl(`/api/bank-facts/${encodeURIComponent(ticker)}`));
    if (!res.ok) {
      console.warn(`[bankFacts] ${ticker} — server returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data) {
      console.warn(`[bankFacts] ${ticker} — server returned null (CIK not found?)`);
      return null;
    }
    console.log(`[bankFacts] ${ticker} — TBV=${data.tangibleBookValue}, CET1=${data.cet1Ratio}, RWA=${data.riskWeightedAssets}`);
    return data;
  } catch (err) {
    console.error(`[bankFacts] ${ticker} fetch failed:`, err.message);
    return null;
  }
}
