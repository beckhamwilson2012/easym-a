// Phase 0b — schema accessor contract. Written test-first: the null-vs-zero assertions ARE
// the reason this module exists. A getValue that returns 0 for a missing field would silently
// undo the entire Stage 11 campaign across every read site at once (D2). Guard it here.
import {
  field, getValue, getStatus, getProvenance, isPresent, unwrapCompany,
  checkRequiredSix, isScaleSane, isStatusLegal,
  STATUSES, SCALES, REQUIRED_SIX,
} from '../financialSchema';

describe('field() factory', () => {
  it('wraps a present number as verified', () => {
    expect(field(100, { source: 'fmp' })).toEqual(
      expect.objectContaining({ value: 100, status: 'verified', source: 'fmp' }));
  });
  it('treats 0 as PRESENT (verified), not missing', () => {
    const w = field(0, { source: 'sec_edgar' });
    expect(w.value).toBe(0);
    expect(w.status).toBe('verified');
  });
  it('treats a negative number as present', () => {
    expect(field(-5).value).toBe(-5);
    expect(field(-5).status).toBe('verified');
  });
  it('null / undefined / NaN → value null, status missing', () => {
    expect(field(null)).toEqual(expect.objectContaining({ value: null, status: 'missing' }));
    expect(field(undefined)).toEqual(expect.objectContaining({ value: null, status: 'missing' }));
    expect(field(NaN)).toEqual(expect.objectContaining({ value: null, status: 'missing' }));
  });
  it('honors an explicit status (override / review / missing)', () => {
    expect(field(50, { status: 'override' }).status).toBe('override');
    expect(field(50, { status: 'review' }).status).toBe('review');
  });
  it('stores a non-empty string (qualitative) as verified', () => {
    expect(field('Bank holding co', { source: 'fmp' }).value).toBe('Bank holding co');
    expect(field('').value).toBe(null); // empty string is not present
  });
  it('always returns a full wrapper object (never null, never bare 0)', () => {
    const w = field(null);
    expect(typeof w).toBe('object');
    ['value', 'currency', 'scale', 'source', 'page', 'label', 'confidence', 'status'].forEach(k =>
      expect(w).toHaveProperty(k));
  });
});

describe('getValue()', () => {
  it('wrapped: verified→number, 0→0, missing→null, override→number', () => {
    expect(getValue(field(100))).toBe(100);
    expect(getValue(field(0))).toBe(0);           // NOT null
    expect(getValue(field(null))).toBe(null);
    expect(getValue(field(50, { status: 'override' }))).toBe(50);
  });
  it('bare: number→number, 0→0, negative→negative', () => {
    expect(getValue(100)).toBe(100);
    expect(getValue(0)).toBe(0);                  // NOT null — the critical case
    expect(getValue(-3)).toBe(-3);
  });
  it('bare: null / undefined / NaN → null', () => {
    expect(getValue(null)).toBe(null);
    expect(getValue(undefined)).toBe(null);
    expect(getValue(NaN)).toBe(null);
  });
  it('0 and null are DISTINGUISHABLE (bare and wrapped)', () => {
    expect(getValue(0)).not.toBe(getValue(null));       // 0 !== null
    expect(getValue(field(0))).not.toBe(getValue(field(null)));
  });
});

describe('getStatus()', () => {
  it('wrapped: returns the stored status', () => {
    expect(getStatus(field(100))).toBe('verified');
    expect(getStatus(field(null))).toBe('missing');
    expect(getStatus(field(9, { status: 'override' }))).toBe('override');
    expect(getStatus(field(9, { status: 'review' }))).toBe('review');
  });
  it('bare present number → verified; bare 0 → verified (present!)', () => {
    expect(getStatus(100)).toBe('verified');
    expect(getStatus(0)).toBe('verified');        // 0 is a real datum
    expect(getStatus(-1)).toBe('verified');
  });
  it('bare null / undefined / NaN → missing', () => {
    expect(getStatus(null)).toBe('missing');
    expect(getStatus(undefined)).toBe('missing');
    expect(getStatus(NaN)).toBe('missing');
  });
  it('bare 0 (verified) and bare null (missing) are distinguishable', () => {
    expect(getStatus(0)).not.toBe(getStatus(null));
  });
});

describe('getProvenance()', () => {
  it('wrapped → {source, page, label}', () => {
    expect(getProvenance(field(100, { source: 'fmp', page: '/income', label: 'Total revenues' })))
      .toEqual({ source: 'fmp', page: '/income', label: 'Total revenues' });
  });
  it('bare → null', () => {
    expect(getProvenance(100)).toBe(null);
    expect(getProvenance(0)).toBe(null);
    expect(getProvenance(null)).toBe(null);
  });
});

describe('isPresent()', () => {
  it('is true ONLY for a real number, INCLUDING 0', () => {
    expect(isPresent(0)).toBe(true);              // asserted explicitly
    expect(isPresent(null)).toBe(false);          // asserted explicitly
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent(NaN)).toBe(false);
    expect(isPresent(-5)).toBe(true);
    expect(isPresent(100)).toBe(true);
  });
  it('wrapped: verified 0 → true, missing → false', () => {
    expect(isPresent(field(0))).toBe(true);
    expect(isPresent(field(null))).toBe(false);
  });
});

describe('validation helpers', () => {
  const full = { revenue: 100, ebit: 20, da: 5, netIncome: 15, cash: 50, totalDebt: 30 };
  it('checkRequiredSix: all present → ok, none missing', () => {
    expect(checkRequiredSix(full)).toEqual({ ok: true, missing: [] });
  });
  it('checkRequiredSix: a required 0 still counts as present', () => {
    expect(checkRequiredSix({ ...full, cash: 0 }).ok).toBe(true);       // 0 cash is real
    expect(checkRequiredSix({ ...full, cash: field(0) }).ok).toBe(true);
  });
  it('checkRequiredSix: null / missing-wrapper field is reported missing', () => {
    expect(checkRequiredSix({ ...full, da: null }).missing).toContain('da');
    expect(checkRequiredSix({ ...full, ebit: field(null) }).missing).toContain('ebit');
  });
  it('isScaleSane / isStatusLegal', () => {
    expect(isScaleSane('millions')).toBe(true);
    expect(isScaleSane('bogus')).toBe(false);
    expect(isStatusLegal('verified')).toBe(true);
    expect(isStatusLegal('bogus')).toBe(false);
    expect(SCALES).toEqual(expect.arrayContaining(['millions', 'thousands', 'units']));
    expect(STATUSES).toEqual(expect.arrayContaining(['verified', 'review', 'missing', 'override']));
    expect(REQUIRED_SIX).toEqual(['revenue', 'ebit', 'da', 'netIncome', 'cash', 'totalDebt']);
  });
});

describe('unwrapCompany() — the /quote boundary', () => {
  it('wrapped verified number → bare number', () => {
    expect(unwrapCompany({ revenue: field(100, { source: 'yahoo' }) })).toEqual({ revenue: 100 });
  });
  it('wrapped verified 0 → 0, NOT null (the case that matters)', () => {
    const out = unwrapCompany({ cash: field(0, { source: 'yahoo' }) });
    expect(out.cash).toBe(0);
    expect(out.cash).not.toBe(null);
  });
  it('wrapped missing → null', () => {
    expect(unwrapCompany({ debt: field(null, { source: 'yahoo', status: 'missing' }) })).toEqual({ debt: null });
  });
  it('bare number → unchanged; bare 0 → 0', () => {
    expect(unwrapCompany({ revenue: 100, cash: 0 })).toEqual({ revenue: 100, cash: 0 });
  });
  it('bare null / undefined → unchanged', () => {
    const out = unwrapCompany({ a: null, b: undefined });
    expect(out.a).toBe(null);
    expect('b' in out).toBe(true);
    expect(out.b).toBe(undefined);
  });
  it('non-numeric passthrough: strings, booleans, nested objects, arrays — all unchanged', () => {
    const ltm = { trusted: true, revenue: 1234, asOf: '2025-06-30' };
    const hist = [10, 20, 30];
    const out = unwrapCompany({
      sic: '6021', dataSource: 'yahoo', reportedCurrency: 'USD',
      fxConverted: false, ltm, revenueHistory: hist,
    });
    expect(out.sic).toBe('6021');
    expect(out.dataSource).toBe('yahoo');
    expect(out.reportedCurrency).toBe('USD');
    expect(out.fxConverted).toBe(false);
    expect(out.ltm).toBe(ltm);            // nested object passed through by reference (shallow)
    expect(out.revenueHistory).toBe(hist); // array passed through
  });
  it('a plain nested object with a coincidental `value` key is NOT unwrapped (needs value+status)', () => {
    const notAWrapper = { value: 5, trusted: true }; // no `status` → not a field wrapper
    expect(unwrapCompany({ ltm: notAWrapper }).ltm).toBe(notAWrapper);
  });
  it('mixed object — correct per field', () => {
    const out = unwrapCompany({
      revenue: field(500, { source: 'yahoo' }),
      name: 'Acme Bancorp',
      cash: field(0, { source: 'yahoo' }),
      debt: field(null, { source: 'yahoo', status: 'missing' }),
      sic: '6021',
      companyType: 'standard',
    });
    expect(out).toEqual({
      revenue: 500, name: 'Acme Bancorp', cash: 0, debt: null,
      sic: '6021', companyType: 'standard',
    });
  });
  it('returns a shallow COPY, not the same object', () => {
    const input = { revenue: field(1) };
    expect(unwrapCompany(input)).not.toBe(input);
  });
  it('non-object input passes through (null / array / primitive)', () => {
    expect(unwrapCompany(null)).toBe(null);
    expect(unwrapCompany(42)).toBe(42);
    const arr = [1, 2]; expect(unwrapCompany(arr)).toBe(arr);
  });
});
