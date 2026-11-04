import { apiUrl } from '../api';
export async function fetchLivePrice(ticker) {
  const resp = await fetch(apiUrl(`/api/price/${encodeURIComponent(ticker)}`));
  const data = await resp.json();
  if (data.error) {
    return { price: null, source: null, attempts: data.attempts || [] };
  }
  return { price: data.price, source: data.source, attempts: data.attempts || [], quoteAsOf: data.asOf ?? null, retrievedAt: data.retrievedAt ?? null };
}

// One daily close for the unaffected-price tile. Null close with a reason when there isn't one.
export async function fetchCloseOn(ticker, date) {
  try {
    const resp = await fetch(apiUrl(`/api/prices/${encodeURIComponent(ticker)}?closeOn=${encodeURIComponent(date)}`));
    const data = await resp.json();
    return data && data.close != null ? { close: data.close, date: data.date, reason: null } : { close: null, date: null, reason: data?.reason || 'no historical price source' };
  } catch {
    return { close: null, date: null, reason: 'no historical price source' };
  }
}
