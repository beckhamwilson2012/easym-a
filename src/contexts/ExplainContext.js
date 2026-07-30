import { createContext, useContext, useState, useCallback } from 'react';

const ExplainContext = createContext(null);

export function ExplainProvider({ children }) {
  const [openId, setOpenId] = useState(null);

  const toggle = useCallback((id) => {
    setOpenId(prev => (prev === id ? null : id));
  }, []);

  const close = useCallback(() => setOpenId(null), []);

  return (
    <ExplainContext.Provider value={{ openId, toggle, close }}>
      {children}
    </ExplainContext.Provider>
  );
}

export function useExplain() {
  const ctx = useContext(ExplainContext);
  if (!ctx) throw new Error('useExplain must be used inside ExplainProvider');
  return ctx;
}
