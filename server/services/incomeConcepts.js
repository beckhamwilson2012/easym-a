'use strict';
// server/services/incomeConcepts.js — the ONE place cost of revenue and gross profit are resolved, so /quote,
// /api/pnl, the LTM legs and the §16 verification (edgarClient) all resolve identically.
//
// COST OF REVENUE, per period, first hit wins:
//   1. CostOfRevenue, CostOfGoodsAndServicesSold, CostOfGoodsSold, CostOfServices (companyfacts)
//   2. a component sum, ONLY when every component is filed for that exact period (sumComponents)
//   3. the filing's own XBRL instance. companyfacts leaves out dimensional facts, so a filer that tags cost only
//      on ProductOrServiceAxis (IRDM, VSAT, GSAT) has nothing current there: IRDM FY25 is ServiceMember
//      197,577,000 + ManufacturedProductOtherMember 50,426,000 = 248,003,000, in the 10-K instance only.
//
// GROSS PROFIT: filed GrossProfit, else revenue − cost of revenue for the same period, labeled "calculated".
// Absent stays null. A filed zero stays zero. Nothing here estimates, carries a value across periods, or
// reads a provider: the filing wins, and FMP stays a cross-check in /api/verified.
//
// Steps 2 and 3 arrive as ordinary dated entries under synthetic concept names (prepareIncomeFacts), so every
// consumer's existing period matching applies to them unchanged.

const { get } = require('../utils/httpGet');
const { FINANCIAL_SIC } = require('../../src/lib/financialSic');

const COMPONENT_SUM_CONCEPT   = 'CostOfRevenueComponentSum';
const FILING_INSTANCE_CONCEPT = 'CostOfRevenueFilingInstance';

const FILED_COST_CONCEPTS = ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'];
const COST_OF_REVENUE_CONCEPTS = {
  gaap: [...FILED_COST_CONCEPTS, COMPONENT_SUM_CONCEPT, FILING_INSTANCE_CONCEPT],
  ifrs: ['CostOfSales', 'CostOfGoodsAndServicesSold'],
};
const GROSS_PROFIT_CONCEPTS = ['GrossProfit'];

// Standard tags that split cost of revenue into goods and services, for filers with no total tag. The
// unsuffixed CostOfGoodsSold / CostOfServices are single concepts in step 1, so they do not appear here.
const COST_COMPONENT_SETS = [
  ['CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization', 'CostOfServicesExcludingDepreciationDepletionAndAmortization'],
];

const DAY = 86400000;
const spanDays = (e) => (e.start ? (Date.parse(e.end) - Date.parse(e.start)) / DAY : null);

// ── Pure arithmetic ───────────────────────────────────────────────────────────────────────────────────────

// All components or nothing. One missing part returns null: a partial sum is a plausible wrong number.
function sumComponents(parts) {
  if (!Array.isArray(parts) || !parts.length) return null;
  let total = 0;
  for (const p of parts) {
    if (p == null || !Number.isFinite(p)) return null;
    total += p;
  }
  return total;
}

// The single revenue − cost subtraction in the app. Works in any unit, as long as both are the same period.
function calculateGrossProfit(revenue, cost) {
  return (revenue != null && cost != null) ? revenue - cost : null;
}

function resolveGrossProfit(filed, revenue, cost) {
  if (filed != null) return { value: filed, basis: 'filed' };
  const calculated = calculateGrossProfit(revenue, cost);
  return calculated != null ? { value: calculated, basis: 'calculated' } : { value: null, basis: null };
}

// The LTM's gross profit for a filer with no filed GrossProfit: per leg, at the revenue window, never annual
// relabeled as LTM. null when cost cannot supply all three legs.
function grossFromCostOfRevenue(rev, cost) {
  if (cost.annual == null || cost.latestYTD == null || cost.priorYTD == null) return null;
  return {
    annual:    calculateGrossProfit(rev.annual, cost.annual),
    latestYTD: calculateGrossProfit(rev.latestYTD, cost.latestYTD),
    priorYTD:  calculateGrossProfit(rev.priorYTD, cost.priorYTD),
    ltm:       calculateGrossProfit(rev.ltm, cost.ltm),
    conceptName: `${rev.conceptName} − ${cost.conceptName}`,
    fellThrough: false,
    derived: true,
  };
}

// ── Period-matched annual lookup ──────────────────────────────────────────────────────────────────────────

// First concept in list order with a 10-K/20-F full-year fact at exactly `end`; latest-filed wins on a
// restatement. A different end date never matches, so a discontinued tag cannot supply a stale value.
function pickAnnualAt(ns, names, end) {
  if (!end) return null;
  for (const concept of names) {
    const entries = ns[concept]?.units?.USD;
    if (!entries) continue;
    const at = entries.filter((e) => {
      if ((e.form !== '10-K' && e.form !== '20-F') || e.end !== end) return false;
      const span = spanDays(e);
      return span == null || (span >= 350 && span <= 380);
    });
    if (at.length) return { ...at.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), at[0]), concept };
  }
  return null;
}

function memberLabel(member) { return String(member).replace(/^.*:/, '').replace(/Member$/, ''); }

// Human-readable source of a resolved cost-of-revenue fact, for the slide note and the /api trace.
function describeCostSource(entry) {
  if (!entry) return null;
  if (entry.concept === FILING_INSTANCE_CONCEPT) {
    const parts = entry.components
      ? entry.components.map((c) => memberLabel(c.member)).join(' + ')
      : entry.filedConcept;
    return `${entry.form} ${entry.accn} XBRL instance (${parts})`;
  }
  if (entry.concept === COMPONENT_SUM_CONCEPT) {
    return `SEC EDGAR companyfacts, sum of ${entry.components.map((c) => c.member).join(' + ')}`;
  }
  return `SEC EDGAR companyfacts (${entry.concept})`;
}

// Source of an LTM cost line, which can span the 10-K and the 10-Q.
function describeLtmCostSource(ns, concept, ends) {
  if (concept !== FILING_INSTANCE_CONCEPT) return concept ? `SEC EDGAR companyfacts (${concept})` : null;
  const used = (ns[concept]?.units?.USD || []).filter((e) => ends.includes(e.end));
  const filings = [...new Set(used.map((e) => `${e.form} ${e.accn}`))];
  return `${filings.join(', ')} XBRL instance`;
}

const costKind = (entry) => (entry.concept === FILING_INSTANCE_CONCEPT ? 'filing-instance'
  : entry.concept === COMPONENT_SUM_CONCEPT ? 'component-sum' : 'companyfacts');

// Both lines for one annual period. Values are raw dollars. revenue must be for the same `end`.
function annualIncomeLines(ns, end, revenue, useIfrs = false) {
  const filed = pickAnnualAt(ns, GROSS_PROFIT_CONCEPTS, end);
  const cost  = pickAnnualAt(ns, useIfrs ? COST_OF_REVENUE_CONCEPTS.ifrs : COST_OF_REVENUE_CONCEPTS.gaap, end);
  const gross = resolveGrossProfit(filed ? filed.val : null, revenue, cost ? cost.val : null);

  let costOfRevenue;
  if (cost) {
    costOfRevenue = { value: cost.val, kind: costKind(cost), label: describeCostSource(cost), concept: cost.concept,
      accn: cost.accn || null, form: cost.form || null, components: cost.components || null };
  } else {
    // A filed gross profit with no cost tag: cost is the same-period identity, and it says so.
    const identity = filed ? calculateGrossProfit(revenue, filed.val) : null;
    costOfRevenue = identity != null
      ? { value: identity, kind: 'calculated', label: 'calculated: revenue − filed gross profit', concept: null, accn: null, form: null, components: null }
      : { value: null, kind: null, label: null, concept: null, accn: null, form: null, components: null };
  }
  return {
    costOfRevenue,
    grossProfit: { ...gross, concept: filed ? filed.concept : null, entry: filed || null,
      label: gross.basis === 'filed' ? 'SEC EDGAR companyfacts (GrossProfit)'
        : gross.basis === 'calculated' ? `calculated: revenue − cost of revenue, ${costOfRevenue.label}` : null },
  };
}

// ── Component sums from companyfacts (step 2) ─────────────────────────────────────────────────────────────

function componentSumEntries(gaap) {
  const out = [];
  for (const set of COST_COMPONENT_SETS) {
    const sides = set.map((c) => gaap[c]?.units?.USD || []);
    const seen = new Set();
    for (const anchor of sides[0]) {
      const key = `${anchor.start}|${anchor.end}|${anchor.form}`;
      if (!anchor.start || seen.has(key)) continue;
      seen.add(key);
      const parts = sides.map((entries) => {
        const at = entries.filter((e) => e.start === anchor.start && e.end === anchor.end && e.form === anchor.form);
        return at.length ? at.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), at[0]) : null;
      });
      const val = sumComponents(parts.map((p) => (p ? p.val : null)));
      if (val == null) continue;
      out.push({ start: anchor.start, end: anchor.end, val, form: anchor.form,
        filed: parts.reduce((m, p) => (p.filed > m ? p.filed : m), ''), accn: anchor.accn,
        components: parts.map((p, i) => ({ member: set[i], val: p.val })) });
    }
  }
  return out;
}

// ── Filing XBRL instance (step 3) ─────────────────────────────────────────────────────────────────────────

const PRODUCT_OR_SERVICE_AXIS = /(^|:)ProductOrServiceAxis$/;

function parseContexts(xml) {
  const contexts = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const start = m[2].match(/startDate>\s*([^<\s]+)/);
    const end   = m[2].match(/endDate>\s*([^<\s]+)/);
    const dims  = [...m[2].matchAll(/explicitMember\b[^>]*\bdimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)].map((d) => ({ axis: d[1], member: d[2] }));
    const typed = /typedMember\b/.test(m[2]);
    contexts[m[1]] = { start: start ? start[1] : null, end: end ? end[1] : null, dims, typed };
  }
  return contexts;
}

function usdUnits(xml) {
  const ids = new Set();
  for (const m of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    if (/<(?:xbrli:)?measure>\s*iso4217:USD\s*<\/(?:xbrli:)?measure>/.test(m[2]) && !/divide/.test(m[2])) ids.add(m[1]);
  }
  return ids;
}

// Every USD duration fact for `concept`, split into undimensioned totals and single-axis ProductOrService
// members. A context with any other dimension is a different cut of the number, so it is ignored.
function factsForConcept(xml, concept, contexts, usd) {
  const totals = {}, members = {};
  const re = new RegExp(`<us-gaap:${concept}\\b([^>]*)>\\s*([^<]*?)\\s*</us-gaap:${concept}>`, 'g');
  for (const m of xml.matchAll(re)) {
    const contextRef = m[1].match(/\bcontextRef="([^"]+)"/);
    const unitRef    = m[1].match(/\bunitRef="([^"]+)"/);
    if (!contextRef || !unitRef || !usd.has(unitRef[1]) || /\bxsi:nil="true"/.test(m[1])) continue;
    const ctx = contexts[contextRef[1]];
    const val = Number(m[2]);
    if (!ctx || !ctx.start || !ctx.end || ctx.typed || m[2] === '' || !Number.isFinite(val)) continue;
    const key = `${ctx.start}|${ctx.end}`;
    if (!ctx.dims.length) totals[key] = val;
    else if (ctx.dims.length === 1 && PRODUCT_OR_SERVICE_AXIS.test(ctx.dims[0].axis)) (members[key] ||= {})[ctx.dims[0].member] = val;
  }
  return { totals, members };
}

// Pure: instance XML → dated cost entries. Which members make up a whole is decided per filing, from the
// members that filing uses for that concept across its periods: IRDM's FY25 10-K uses ManufacturedProductOther
// and its Q3-26 10-Q uses SubscriptionAndCirculation for the same line, so a fixed list would be wrong. A
// period missing any of the filing's members gets no entry. A single member is not a split at all. A sum
// larger than the same period's filed CostsAndExpenses is overlapping members, not a total, and is rejected.
function parseInstanceCosts(xml, meta = {}) {
  const contexts = parseContexts(xml);
  const usd = usdUnits(xml);
  const costsAndExpenses = factsForConcept(xml, 'CostsAndExpenses', contexts, usd).totals;
  const byPeriod = {};
  for (const concept of FILED_COST_CONCEPTS) {
    const { totals, members } = factsForConcept(xml, concept, contexts, usd);
    const required = [...new Set(Object.values(members).flatMap((m) => Object.keys(m)))];
    for (const [key, val] of Object.entries(totals)) {
      if (!byPeriod[key]) byPeriod[key] = { val, filedConcept: concept, components: null };
    }
    if (required.length < 2) continue;
    for (const [key, atPeriod] of Object.entries(members)) {
      if (byPeriod[key]) continue;
      const val = sumComponents(required.map((member) => (member in atPeriod ? atPeriod[member] : null)));
      if (val == null) continue;
      if (costsAndExpenses[key] != null && val > costsAndExpenses[key]) continue;
      byPeriod[key] = { val, filedConcept: concept, components: required.map((member) => ({ member, val: atPeriod[member] })) };
    }
  }
  return Object.entries(byPeriod).map(([key, e]) => {
    const [start, end] = key.split('|');
    return { start, end, ...e, form: meta.form || null, filed: meta.filed || null, accn: meta.accn || null, concept: FILING_INSTANCE_CONCEPT };
  });
}

const UA = { 'User-Agent': 'EasyMandA contact@easymanda.com' };
const INSTANCE_TIMEOUT_MS = 20000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const instanceCache = new Map();   // accession → { entries, ts, failed }. A filing never changes, so success has no TTL.

async function fetchInstanceCosts(cik, filing) {
  const cached = instanceCache.get(filing.accn);
  if (cached && (!cached.failed || Date.now() - cached.ts < FAILURE_RETRY_MS)) return cached.promise;
  const promise = (async () => {
    const folder = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${filing.accn.replace(/-/g, '')}`;
    const index = await get(`${folder}/index.json`);
    const names = (index?.directory?.item || []).map((i) => i.name);
    const instance = names.find((n) => /_htm\.xml$/.test(n))
      || names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/i.test(n));
    if (!instance) return [];
    const r = await fetch(`${folder}/${instance}`, { headers: UA, signal: AbortSignal.timeout(INSTANCE_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseInstanceCosts(await r.text(), filing);
  })().catch((e) => {
    console.error(`[incomeConcepts] instance read failed for ${filing.accn}: ${e.message}`);
    instanceCache.set(filing.accn, { promise: Promise.resolve([]), failed: true, ts: Date.now() });
    return [];
  });
  instanceCache.set(filing.accn, { promise, failed: false, ts: Date.now() });
  return promise;
}

// Latest 10-K and 10-Q period ends, from Assets: an instant nearly every filer tags at every period.
function latestPeriodEnds(gaap) {
  const entries = gaap.Assets?.units?.USD || [];
  const latest = (form) => entries.filter((e) => e.form === form).reduce((m, e) => (e.end > m ? e.end : m), '');
  const annualEnd = latest('10-K'), interimEnd = latest('10-Q');
  return { annualEnd: annualEnd || null, interimEnd: interimEnd > annualEnd ? interimEnd : null };
}

function hasCostAt(gaap, end, form) {
  return COST_OF_REVENUE_CONCEPTS.gaap.some((c) => (gaap[c]?.units?.USD || []).some((e) => e.end === end && e.form === form && e.start));
}

const submissionsCache = new Map();
async function submissions(cik) {
  const hit = submissionsCache.get(cik);
  if (hit && Date.now() - hit.ts < FAILURE_RETRY_MS) return hit.sub;
  const sub = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
  submissionsCache.set(cik, { sub, ts: Date.now() });
  return sub;
}

// The filer's SIC as a string, or null when submissions cannot be read.
async function filerSic(cik) {
  try { return (await submissions(cik))?.sic ?? null; } catch { return null; }
}

// Filings to read: only the latest 10-K / 10-Q whose period companyfacts cannot supply. A filer that tags cost
// in companyfacts gets no extra request. Banks have no cost of revenue, so their (very large) filings are skipped.
async function filingsWithCostGap(gaap, cik) {
  const { annualEnd, interimEnd } = latestPeriodEnds(gaap);
  const annualGap  = annualEnd  && !hasCostAt(gaap, annualEnd, '10-K');
  const interimGap = interimEnd && !hasCostAt(gaap, interimEnd, '10-Q');
  if (!annualGap && !interimGap) return [];
  const sub = await submissions(cik);
  if (FINANCIAL_SIC.includes(String(sub?.sic))) return [];
  const recent = sub?.filings?.recent;
  if (!recent) return [];
  const find = (form, end) => {
    const i = recent.form.findIndex((f, idx) => f === form && recent.reportDate[idx] === end);
    return i >= 0 ? { form, accn: recent.accessionNumber[i], filed: recent.filingDate[i] } : null;
  };
  return [annualGap ? find('10-K', annualEnd) : null, interimGap ? find('10-Q', interimEnd) : null].filter(Boolean);
}

// Returns a copy of companyfacts with steps 2 and 3 added as synthetic us-gaap concepts. The cached original
// is not modified. Never throws: a failed filing read leaves those periods absent, which render as null.
async function prepareIncomeFacts(facts, cik) {
  const gaap = facts?.facts?.['us-gaap'];
  if (!gaap || !Object.keys(gaap).length) return facts;
  const extended = { ...gaap };
  const components = componentSumEntries(gaap).map((e) => ({ ...e, concept: COMPONENT_SUM_CONCEPT }));
  if (components.length) extended[COMPONENT_SUM_CONCEPT] = { units: { USD: components } };
  try {
    const filings = cik ? await filingsWithCostGap(extended, cik) : [];
    const instance = (await Promise.all(filings.map((f) => fetchInstanceCosts(cik, f)))).flat();
    if (instance.length) extended[FILING_INSTANCE_CONCEPT] = { units: { USD: instance } };
  } catch (e) {
    console.error(`[incomeConcepts] cost gap check failed for CIK ${cik}: ${e.message}`);
  }
  return { ...facts, facts: { ...facts.facts, 'us-gaap': extended } };
}

module.exports = {
  COST_OF_REVENUE_CONCEPTS, GROSS_PROFIT_CONCEPTS, FILING_INSTANCE_CONCEPT, COMPONENT_SUM_CONCEPT,
  sumComponents, calculateGrossProfit, resolveGrossProfit, grossFromCostOfRevenue,
  pickAnnualAt, annualIncomeLines, describeCostSource, describeLtmCostSource, componentSumEntries, parseInstanceCosts, prepareIncomeFacts, filerSic,
};
