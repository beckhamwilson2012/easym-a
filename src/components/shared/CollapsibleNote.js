import { useState, useEffect } from 'react';

export function CollapsibleNote({ label, children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#6B7280' }}>{label}</span>
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#0070D2', padding: '0 0 0 4px',
            lineHeight: 1, display: 'inline-flex', alignItems: 'center',
            transition: 'transform 0.15s',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#004A99'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#0070D2'; }}
        >▾</button>
      </span>
      {open && (
        <div
          className="collapsible-content"
          style={{
            background: '#F8FAFC',
            borderTop: '1px solid #E5E7EB',
            padding: 12,
            fontSize: 12,
            color: '#374151',
            lineHeight: 1.5,
            marginTop: 4,
            borderRadius: 4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
