import { useState, useEffect, useRef } from 'react';

// Fetches /api/verified/:ticker once per ticker; caches in memory across re-renders.
const memCache = {};

export function useVerifiedData(ticker) {
  const [data, setData]       = useState(ticker ? memCache[ticker] ?? null : null);
  const [loading, setLoading] = useState(!!ticker && !memCache[ticker]);
  const [error, setError]     = useState(null);
  const abortRef              = useRef(null);

  useEffect(() => {
    if (!ticker) { setData(null); setLoading(false); return; }
    if (memCache[ticker]) { setData(memCache[ticker]); setLoading(false); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    fetch(`http://localhost:3001/api/verified/${ticker}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        memCache[ticker] = d;
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        if (e.name !== 'AbortError') {
          setError(e.message);
          setLoading(false);
        }
      });

    return () => ctrl.abort();
  }, [ticker]);

  return { data, loading, error };
}
