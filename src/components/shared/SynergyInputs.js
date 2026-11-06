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

// "FY ended Dec 31, 2025" → "FY25"; "LTM to Jun 30, 2026" → "LTM Jun 30, 2026". Anything else is shown as it is.
export function shortPeriod(period) {
  const fy = /^FY ended .*?(\d{4})$/.exec(period || '');
  if (fy) return `FY${fy[1].slice(2)}`;
  const ltm = /^LTM to (.+)$/.exec(period || '');
  if (ltm) return `LTM ${ltm[1]}`;
  return period || 'period unknown';
}

const infoButton = (section, open, setOpen, testId) => (
  <button type="button" data-testid={testId || `${section}-info-toggle`} onClick={() => setOpen(v => !v)} aria-expanded={open}
    style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0, marginLeft: 4 }}>ⓘ</button>
);
const infoBox = (section, children) => (
  <div data-testid={`${section}-info`} style={{ ...small, color: '#374151', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>{children}</div>
);

// The Conservative / Base / Aggressive buttons. Each fills Years 1-3 from the base and its percentage.
function PresetButtons({ section, base, pcts, namePrefix, onChange }) {
  const off = base.amount == null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
      {SYNERGY_PRESETS.map((p) => {
        const years = off ? null : presetYears(base.amount, pcts[p.key]);
        return (
          <button key={p.key} type="button" disabled={off || years == null} data-testid={`preset-${section}-${p.key}`}
            onClick={() => years.forEach((v, i) => onChange(`${namePrefix}${i + 1}`, v))}
            style={{ flex: '1 1 110px', minWidth: 0, padding: '6px 4px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, fontWeight: 600, background: off ? '#F3F4F6' : '#fff', color: off ? '#9CA3AF' : '#0F2244', cursor: off ? 'not-allowed' : 'pointer' }}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// The editable percentages, inside the info box. They stay in the section's state while the box is closed.
function PresetPercents({ section, base, pcts, setPcts }) {
  const off = base.amount == null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SYNERGY_PRESETS.map((p) => (
          <div key={p.key} style={{ flex: '1 1 90px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>{p.label}</span>
            <input type="number" step="any" aria-label={`${p.label} ${section} preset percent`} data-testid={`pct-${section}-${p.key}`} disabled={off} value={pcts[p.key]}
              onChange={(e) => setPcts((prev) => ({ ...prev, [p.key]: e.target.value }))}
              style={{ width: '100%', minWidth: 0, padding: '3px 4px', borderRadius: 4, border: '1px solid #E5E7EB', fontSize: 12, textAlign: 'right', boxSizing: 'border-box' }} />
            <span style={{ fontSize: 12, color: '#6B7280' }}>%</span>
          </div>
        ))}
      </div>
      <div style={{ fontStyle: 'italic', marginTop: 4 }}>Percentages: app default, editable. Year 1-3 ramp 40% / 70% / 100%.</div>
    </div>
  );
}

const defaultPcts = () => Object.fromEntries(SYNERGY_PRESETS.map((p) => [p.key, p.pct]));

// Input page: cost and revenue synergies. All arithmetic is in lib/synergies. Each section shows its buttons, its
// Year 1-3 boxes and one short base line; the formula, sources, ramp and margin explanation are behind its ⓘ.
export function SynergyInputs({ inputs, onChange }) {
  const cost = costSynergyBase(inputs);
  const revenue = revenueSynergyBase(inputs);
  const { years, margin, anyEntered, anyRevenue, revenueOnly } = synergySchedule(inputs);
  const [costPcts, setCostPcts] = useState(defaultPcts);
  const [revenuePcts, setRevenuePcts] = useState(defaultPcts);
  const [costOpen, setCostOpen] = useState(false);
  const [revenueOpen, setRevenueOpen] = useState(false);
  const marginNull = margin.pct == null;
  return (
    <div data-testid="synergy-inputs">
      <h3 style={{ color: '#0F2244', fontSize: 14, margin: '0 0 8px' }}>Cost synergies</h3>
      <PresetButtons section="cost" base={cost} pcts={costPcts} namePrefix="synergiesY" onChange={onChange} />
      <div data-testid="cost-base-short" style={{ ...small, marginBottom: 8, color: cost.amount != null ? '#6B7280' : '#92400E' }}>
        {cost.amount != null
          ? <>Base {fmtBase(cost.amount)} · {shortPeriod(cost.period)}</>
          : <>Presets off: the target's {cost.missing.join(' and ')} {cost.missing.length > 1 ? 'are' : 'is'} missing</>}
        {infoButton('cost', costOpen, setCostOpen)}
      </div>
      {costOpen && infoBox('cost', <>
        <PresetPercents section="cost" base={cost} pcts={costPcts} setPcts={setCostPcts} />
        {cost.amount != null ? (
          <div data-testid="cost-base">
            Base {fmtBase(cost.amount)} = target cost of revenue {fmtBase(cost.costOfRevenue)} + total operating expenses {fmtBase(cost.operatingExpenses)}. {cost.period}. Source: {cost.source}.
          </div>
        ) : (
          <div data-testid="cost-base" style={{ color: '#92400E' }}>
            Presets off: the target's {cost.missing.join(' and ')} {cost.missing.length > 1 ? 'are' : 'is'} missing. Enter dollars by hand.
          </div>
        )}
      </>)}
      <div style={{ display: 'flex', gap: 8 }}>
        {SYNERGY_YEARS.map((y) => <YearField key={y} name={`synergiesY${y}`} year={y} value={inputs[`synergiesY${y}`] ?? null} onChange={onChange} />)}
      </div>

      <h3 style={{ color: '#0F2244', fontSize: 14, margin: '16px 0 8px', paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>Revenue synergies</h3>
      <PresetButtons section="revenue" base={revenue} pcts={revenuePcts} namePrefix="revenueSynergiesY" onChange={onChange} />
      <div data-testid="revenue-base-short" style={{ ...small, marginBottom: 8, color: revenue.amount != null ? '#6B7280' : '#92400E' }}>
        {revenue.amount != null
          ? <>Base {fmtBase(revenue.amount)} · {shortPeriod(revenue.period)}</>
          : <>Presets off: the target's revenue is missing</>}
        {infoButton('revenue', revenueOpen, setRevenueOpen)}
      </div>
      {marginNull && (
        <div data-testid="revenue-only-flag" style={{ fontSize: 12, color: '#92400E', marginBottom: 8 }}>
          ⚠ Revenue synergies not added to EBITDA{infoButton('revenue-flag', revenueOpen, setRevenueOpen, 'revenue-flag-info-button')}
        </div>
      )}
      {revenueOpen && infoBox('revenue', <>
        <PresetPercents section="revenue" base={revenue} pcts={revenuePcts} setPcts={setRevenuePcts} />
        {revenue.amount != null ? (
          <div data-testid="revenue-base" style={{ marginBottom: 4 }}>
            Base {fmtBase(revenue.amount)} = target revenue. {revenue.period}. Source: {revenue.source}.
          </div>
        ) : (
          <div data-testid="revenue-base" style={{ color: '#92400E', marginBottom: 4 }}>Presets off: the target's revenue is missing. Enter dollars by hand.</div>
        )}
        <div data-testid="gross-margin" style={{ color: marginNull ? '#92400E' : '#374151' }}>
          {marginSentence(margin)} {!marginNull ? 'Revenue synergies reach EBITDA at this margin.' : REVENUE_ONLY_FLAG}
        </div>
      </>)}
      <div style={{ display: 'flex', gap: 8 }}>
        {SYNERGY_YEARS.map((y) => <YearField key={y} name={`revenueSynergiesY${y}`} year={y} value={inputs[`revenueSynergiesY${y}`] ?? null} onChange={onChange} />)}
      </div>

      <div data-testid="synergy-total" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #F3F4F6', fontSize: 12, color: '#374151' }}>
        <strong style={{ color: '#0F2244' }}>Total synergies (EBITDA impact)</strong>
        {years.map((y) => <div key={y.year}>Year {y.year}: {y.entered ? fmtSynergy(y.ebitda) : NONE_ENTERED}</div>)}
        {!anyEntered && <div style={{ ...small, fontStyle: 'italic' }}>No synergy is assumed until one is entered.</div>}
        {anyRevenue && !revenueOnly && <div style={{ ...small, fontStyle: 'italic' }}>Cost synergies + revenue synergies × combined gross margin.</div>}
      </div>
    </div>
  );
}
