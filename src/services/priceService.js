import { apiUrl } from '../api';
export async function fetchLivePrice(ticker) {
  const resp = await fetch(apiUrl(`/api/price/${encodeURIComponent(ticker)}`));
  const data = await resp.json();
  if (data.error) {
    return { price: null, source: null, attempts: data.attempts || [] };
  }
  return { price: data.price, source: data.source, attempts: data.attempts || [] };
}
