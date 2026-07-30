export async function getSegmentRevenue(ticker) {
  if (!ticker) return { source: 'estimated', year: null, segments: [] };
  try {
    const res = await fetch(`http://localhost:3001/api/segments/${encodeURIComponent(ticker)}`);
    return await res.json();
  } catch {
    return { source: 'estimated', year: null, segments: [] };
  }
}
