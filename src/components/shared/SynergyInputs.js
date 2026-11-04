import { useEffect, useState } from 'react';
import { SYNERGY_PRESETS, SYNERGY_YEARS, NONE_ENTERED, REVENUE_ONLY_FLAG, costSynergyBase, revenueSynergyBase, synergySchedule, presetYears, marginSentence, fmtSynergy } from '../../lib/synergies';

const BLUE = '#1a5fd0';
const small = { fontSize: 11, color: '#6B7280', lineHeight: 1.45 };
const fmtBase = (v) => `$${Math.round(v).toLocaleString('en-US')}M`;
const show = (v) => (v == null ? '' : String(Number(Number(v).toFixed(4))));

// Empty is null, not 0: an empty box means no synergy is assumed, and a typed 0 stays a real 0.
function YearField({ name, year, value, onChange }) {
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((prev) => {
      const parsed = parseFloat(prev);
      const same = value == null ? prev === '' : parsed === value;
      return same ? prev : show(value);
    });
  }, [value]);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Year {year} ($M)</label>
      <input type="number" step="any" name={name} value={text} placeholder="$M"
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          onChange(name, Number.isFinite(n) ? n : null);
        }}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box', background: '#fff', color: value != null ? BLUE : 'inherit' }} />
      <div data-testid={`${name}-state`} style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3, fontStyle: 'italic', minHeight: 15 }}>{value == null ? NONE_ENTERED : ''}</div>
    </div>
  );
}

function PresetRow({ section, base, namePrefix, onChange }) {
  const [pcts, setPcts] = useState(() => Object.fromEntries(SYNERGY_PRESETS.map((p) => [p.key, p.pct])));
  const off = base.amount == null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SYNERGY_PRESETS.map((p) => {
          const years = off ? null : presetYears(base.amount, pcts[p.key]);
          return (
            <div key={p.key} style={{ flex: '1 1 110px', minWidth: 0 }}>
              <button type="button" disabled={off || years == null} data-testid={`preset-${section}-${p.key}`}
                onClick={() => years.forEach((v, i) => onChange(`${namePrefix}${i + 1}`, v))}
                style={{ width: '100%', padding: '6px 4px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, fontWeight: 600, background: off ? '#F3F4F6' : '#fff', color: off ? '#9CA3AF' : '#0F2244', cursor: off ? 'not-allowed' : 'pointer' }}>
                {p.label}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                <input type="number" step="any" aria-label={`${p.label} ${section} preset percent`} data-testid={`pct-${section}-${p.key}`} disabled={off} value={pcts[p.key]}
                  onChange={(e) => setPcts((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  style={{ width: '100%', minWidth: 0, padding: '3px 4px', borderRadius: 4, border: '1px solid #E5E7EB', fontSize: 12, textAlign: 'right', boxSizing: 'border-box' }} />
                <span style={{ fontSize: 12, color: '#6B7280' }}>%</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ ...small, fontStyle: 'italic', marginTop: 4 }}>Percentages: app default, editable. Year 1-3 ramp 40% / 70% / 100%.</div>
    </div>
  );
}

// Input page: cost and revenue synergies. All arithmetic is in lib/synergies.
export function SynergyInputs({ inputs, onChange }) {
  const cost = costSynergyBase(inputs);
  const revenue = revenueSynergyBase(inputs);
  const { years, margin, anyEntered, anyRevenue, revenueOnly } = synergySchedule(inputs);
  return (
    <div data-testid="synergy-inputs">
      <h3 style={{ color: '#0F2244', fontSize: 14, margin: '0 0 8px' }}>Cost synergies</h3>
      <PresetRow section="cost" base={cost} namePrefix="synergiesY" onChange={onChange} />
      {cost.amount != null ? (
        <div data-testid="cost-base" style={{ ...small, marginBottom: 8 }}>
          Base {fmtBase(cost.amount)} = target cost of revenue {fmtBase(cost.costOfRevenue)} + total operating expenses {fmtBase(cost.operatingExpenses)}. {cost.period}. Source: {cost.source}.
        </div>
      ) : (
        <div data-testid="cost-base" style={{ ...small, color: '#92400E', marginBottom: 8 }}>
          Presets off: the target's {cost.missing.join(' and ')} {cost.missing.length > 1 ? 'are' : 'is'} missing. Enter dollars by hand.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {SYNERGY_YEARS.map((y) => <YearField key={y} name={`synergiesY${y}`} year={y} value={inputs[`synergiesY${y}`] ?? null} onChange={onChange} />)}
      </div>

      <h3 style={{ color: '#0F2244', fontSize: 14, margin: '16px 0 8px', paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>Revenue synergies</h3>
      <PresetRow section="revenue" base={revenue} namePrefix="revenueSynergiesY" onChange={onChange} />
      {revenue.amount != null ? (
        <div data-testid="revenue-base" style={{ ...small, marginBottom: 8 }}>
          Base {fmtBase(revenue.amount)} = target revenue. {revenue.period}. Source: {revenue.source}.
        </div>
      ) : (
        <div data-testid="revenue-base" style={{ ...small, color: '#92400E', marginBottom: 8 }}>Presets off: the target's revenue is missing. Enter dollars by hand.</div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {SYNERGY_YEARS.map((y) => <YearField key={y} name={`revenueSynergiesY${y}`} year={y} value={inputs[`revenueSynergiesY${y}`] ?? null} onChange={onChange} />)}
      </div>
      <div data-testid="gross-margin" style={{ ...small, marginTop: 6, color: margin.pct == null ? '#92400E' : '#6B7280' }}>
        {marginSentence(margin)} {margin.pct != null ? 'Revenue synergies reach EBITDA at this margin.' : REVENUE_ONLY_FLAG}
      </div>
      {revenueOnly && (
        <div data-testid="revenue-only-flag" style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '6px 10px', marginTop: 6 }}>
          ⚠ {REVENUE_ONLY_FLAG}
        </div>
      )}

      <div data-testid="synergy-total" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #F3F4F6', fontSize: 12, color: '#374151' }}>
        <strong style={{ color: '#0F2244' }}>Total synergies (EBITDA impact)</strong>
        {years.map((y) => <div key={y.year}>Year {y.year}: {y.entered ? fmtSynergy(y.ebitda) : NONE_ENTERED}</div>)}
        {!anyEntered && <div style={{ ...small, fontStyle: 'italic' }}>No synergy is assumed until one is entered.</div>}
        {anyRevenue && !revenueOnly && <div style={{ ...small, fontStyle: 'italic' }}>Cost synergies + revenue synergies × combined gross margin.</div>}
      </div>
    </div>
  );
}
