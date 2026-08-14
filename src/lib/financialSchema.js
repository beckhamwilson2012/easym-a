// ─────────────────────────────────────────────────────────────────────────────
// Canonical company financial schema — Phase 0 (ADDITIVE; see docs/SCHEMA.md).
//
// One wrapped shape per field, carrying provenance and — the whole point —
// distinguishing a real ZERO from a MISSING value. The accessors read BOTH the
// wrapped shape and today's bare values transparently, so wrapping a builder
// changes no rendered value (no read site needs to know which shape it got).
//
// Trap (guarded by financialSchema.test.js): the accessors are the one place a
// coercion bug would be invisible and universal — a getValue that returned 0 for
// a missing field would silently undo the Stage 11 campaign across every read
// site at once. Hence: NO `|| 0`, NO `?? 0`, NO `=== 0` absence checks here.
// ─────────────────────────────────────────────────────────────────────────────

export const STATUSES = ['verified', 'review', 'missing', 'override'];
export const SCALES   = ['millions', 'thousands', 'units'];
export const REQUIRED_SIX = ['revenue', 'ebit', 'da', 'netIncome', 'cash', 'totalDebt'];

// Presence for a NUMERIC datum: a finite number, INCLUDING 0, EXCLUDING null/undefined/NaN.
// This single predicate is the zero-vs-missing boundary every accessor routes through.
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
// A present value is a real number (incl 0) OR a non-empty string (qualitative fields).
const isPresentValue = (v) => isNumber(v) || (typeof v === 'string' && v !== '');
// A wrapper is a plain object carrying a `value` slot (the canonical field shape).
const isWrapper = (f) => f !== null && typeof f === 'object' && !Array.isArray(f) && 'value' in f;

// ── Wrapper factory ──────────────────────────────────────────────────────────
// field(value, { source, page, label, confidence, status, currency, scale })
//   present number (incl 0) or non-empty string → stored, default status 'verified'
//   null / undefined / NaN / '' → value null, default status 'missing'
// An explicit `status` (e.g. 'override', 'review', 'missing') is honored as given.
export function field(value, opts = {}) {
  const {
    source = null, page = null, label = null, confidence = null,
    status = null, currency = null, scale = null,
  } = opts;
  const present = isPresentValue(value);
  const resolvedStatus = status !== null ? status : (present ? 'verified' : 'missing');
  return {
    value: present ? value : null,
    currency, scale, source, page, label, confidence,
    status: resolvedStatus,
  };
}

// ── Accessors — transparent over wrapped + bare ──────────────────────────────

// getValue(f) → the number, or null. Never coerces a missing value to 0.
export function getValue(f) {
  const raw = isWrapper(f) ? f.value : f;
  return isNumber(raw) ? raw : null;
}

// getStatus(f) → the status. A bare present value → 'verified'; bare null/undefined/NaN/''
// → 'missing'. (Bare 0 is present → 'verified'. That is the distinction that matters.)
export function getStatus(f) {
  if (isWrapper(f)) return f.status;
  return isPresentValue(f) ? 'verified' : 'missing';
}

// getProvenance(f) → { source, page, label } for a wrapper; null for a bare value.
export function getProvenance(f) {
  if (!isWrapper(f)) return null;
  return { source: f.source, page: f.page, label: f.label };
}

// isPresent(f) → true ONLY for a real number, INCLUDING 0. null/undefined/NaN/missing → false.
export function isPresent(f) {
  const raw = isWrapper(f) ? f.value : f;
  return isNumber(raw);
}

// ── Field definitions (docs/SCHEMA.md §1) ────────────────────────────────────
// kind: 'primitive' | 'meta'; req: 'required' | 'optional'. Derived values are NOT here (§4).
export const FIELDS = {
  // required six
  revenue:   { kind: 'primitive', req: 'required', unit: '$M' },
  ebit:      { kind: 'primitive', req: 'required', unit: '$M' },
  da:        { kind: 'primitive', req: 'required', unit: '$M' },
  netIncome: { kind: 'primitive', req: 'required', unit: '$M' },
  cash:      { kind: 'primitive', req: 'required', unit: '$M' },
  totalDebt: { kind: 'primitive', req: 'required', unit: '$M' },
  // income statement (ebitda is dual-provenance — stored primitive OR derived ebit+da, §1/§4)
  ebitda:    { kind: 'primitive', req: 'optional', unit: '$M', provenance: ['fmp_reported', 'derived_ebit_plus_da'] },
  cogs:      { kind: 'primitive', req: 'optional', unit: '$M' },
  grossProfit: { kind: 'primitive', req: 'optional', unit: '$M' },
  sga:       { kind: 'primitive', req: 'optional', unit: '$M' },
  rnd:       { kind: 'primitive', req: 'optional', unit: '$M' },
  otherOpex: { kind: 'primitive', req: 'optional', unit: '$M' },
  interestExpense: { kind: 'primitive', req: 'optional', unit: '$M' },
  otherIncome: { kind: 'primitive', req: 'optional', unit: '$M' },
  pretaxIncome: { kind: 'primitive', req: 'optional', unit: '$M' },
  tax:       { kind: 'primitive', req: 'optional', unit: '$M' },
  // balance sheet
  ar:        { kind: 'primitive', req: 'optional', unit: '$M' },
  inventory: { kind: 'primitive', req: 'optional', unit: '$M' },
  totalCurrentAssets: { kind: 'primitive', req: 'optional', unit: '$M' },
  totalAssets: { kind: 'primitive', req: 'optional', unit: '$M' },
  ap:        { kind: 'primitive', req: 'optional', unit: '$M' },
  currentPortionLTD: { kind: 'primitive', req: 'optional', unit: '$M' },
  longTermDebt: { kind: 'primitive', req: 'optional', unit: '$M' },
  totalLiabilities: { kind: 'primitive', req: 'optional', unit: '$M' },
  totalEquity: { kind: 'primitive', req: 'optional', unit: '$M' },
  shortTermInvestments: { kind: 'primitive', req: 'optional', unit: '$M' },
  tangibleBookValue: { kind: 'primitive', req: 'optional', unit: '$M' },
  // cash flow
  cashFromOps: { kind: 'primitive', req: 'optional', unit: '$M' },
  capex:     { kind: 'primitive', req: 'optional', unit: '$M' },
  stockComp: { kind: 'primitive', req: 'optional', unit: '$M' },
  changeInWC: { kind: 'primitive', req: 'optional', unit: '$M' },
  // market data
  sharePrice: { kind: 'primitive', req: 'optional', unit: '$/sh' },
  sharesOutstanding: { kind: 'primitive', req: 'optional', unit: 'sh(M)' },
  dilutedShares: { kind: 'primitive', req: 'optional', unit: 'sh(M)' },
  eps:       { kind: 'primitive', req: 'optional', unit: '$/sh' },
  // qualitative
  businessDescription: { kind: 'primitive', req: 'optional', unit: 'text' },
  hq:        { kind: 'primitive', req: 'optional', unit: 'text' },
  employees: { kind: 'primitive', req: 'optional', unit: 'count' },
  foundingYear: { kind: 'primitive', req: 'optional', unit: 'year' },
  sic:       { kind: 'primitive', req: 'optional', unit: 'code' },
  sector:    { kind: 'primitive', req: 'optional', unit: 'text' },
  // meta
  currency:  { kind: 'meta', req: 'required', unit: 'ISO4217' },
  scale:     { kind: 'meta', req: 'required', unit: 'enum' },
  fiscalYearEnd: { kind: 'meta', req: 'optional', unit: 'date' },
  periodLabel: { kind: 'meta', req: 'optional', unit: 'text' },
  hasMarketData: { kind: 'meta', req: 'required', unit: 'bool' },
};

// Derived values that must NEVER be stored as fields (docs/SCHEMA.md §4). Listed so a future
// validator can assert none of these leaks into a canonical object.
export const DERIVED = [
  'ebitdaSelfDerived', 'netDebt', 'enterpriseValue', 'tradingEquityValue',
  'freeCashFlow', 'acquisitionEquityValue',
];

// ── Validation helpers ───────────────────────────────────────────────────────

// required-six presence: each required field must be a present number (incl 0). Works over
// wrapped or bare values via isPresent — a 'missing' wrapper and a null both fail; a 0 passes.
export function checkRequiredSix(company = {}) {
  const missing = REQUIRED_SIX.filter((k) => !isPresent(company[k]));
  return { ok: !missing.length, missing };
}

export function isScaleSane(scale) {
  return SCALES.includes(scale);
}

export function isStatusLegal(status) {
  return STATUSES.includes(status);
}
