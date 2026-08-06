import { apiUrl } from '../api';
export async function getSegmentRevenue(ticker) {
  if (!ticker) return { source: 'estimated', year: null, segments: [] };
  try {
    const res = await fetch(apiUrl(`/api/segments/${encodeURIComponent(ticker)}`));
    return await res.json();
  } catch {
    return { source: 'estimated', year: null, segments: [] };
  }
}
