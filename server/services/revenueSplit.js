'use strict';
// server/services/revenueSplit.js — the company's own revenue split from its latest 10-K XBRL instance (Fix 17 Task 9).
//
// Revenue facts that carry exactly ONE explicit dimension member, for the fiscal year the 10-K covers, are grouped by
// axis. An axis is shown only when it has two or more members and they sum to the filing's own undimensioned total of
// the same revenue concept, same period, within 0.5%. Nothing is estimated: an axis that doesn't tie is reported with
// its sum and is not shown, and no tying axis means { ok: false } with the reason. Never throws.

const { latestPeriodicFiling, readInstanceXml, readSubmissions, numericFacts, usdUnits } = require('./filingInstance');

const TIE = 0.005;   // 0.5% of the filed total
const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues',
  'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet',
];
// Box → axes, in order of preference. A company's own (custom) axis counts as a product/segment split.
const PRODUCT_AXES = ['srt:ProductOrServiceAxis', 'us-gaap:StatementBusinessSegmentsAxis'];
const GEO_AXES = ['srt:StatementGeographicalAxis'];
const NOT_A_SPLIT = new Set(['srt:ConsolidationItemsAxis', 'srt:RangeAxis', 'srt:MajorCustomersAxis', 'us-gaap:TimingOfTransferOfGoodOrServiceAxis',
  'us-gaap:ConcentrationRiskByBenchmarkAxis', 'us-gaap:ConcentrationRiskByTypeAxis', 'srt:StatementScenarioAxis', 'us-gaap:ContractWithCustomerSalesChannelAxis']);

// The latest 10-K (or 10-K/A, 10-KT) in a submissions payload, in latestPeriodicFiling's shape, or null.
function latestTenK(sub) {
  const r = sub && sub.filings && sub.filings.recent;
  if (!r || !r.form) return null;
  const only = { filings: { recent: { ...r, form: r.form.map((f) => (/^10-K/.test(f) ? f : '__')) } } };
  return latestPeriodicFiling(only);
}

// Pure: contexts with their duration and dimension members.
function durationContexts(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    const start = (body.match(/<(?:xbrli:)?startDate>\s*([0-9-]+)\s*</) || [])[1] || null;
    const end = (body.match(/<(?:xbrli:)?endDate>\s*([0-9-]+)\s*</) || [])[1] || null;
    const members = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((x) => ({ dimension: x[1], member: x[2] }));
    const typed = /<xbrldi:typedMember\b/.test(body);
    out[m[1]] = { start, end, members, typed };
  }
  return out;
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
// "omda:HealthPlanMember" → "Health Plan"; "country:US" → "US".
function humanize(qname) {
  const local = String(qname).split(':').pop().replace(/Member$/, '').replace(/Axis$/, '');
  return local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/^Non Us$/, 'Non-US').trim();
}
const AXIS_NAMES = { 'srt:ProductOrServiceAxis': 'product or service', 'srt:StatementGeographicalAxis': 'geographic area', 'us-gaap:StatementBusinessSegmentsAxis': 'business segment' };
const axisLabel = (axis) => `${AXIS_NAMES[axis] || humanize(axis)} axis`;

// Pure: every axis evaluated for the fiscal year in one instance. → { fy, end, concept, total, axes: [...] } or null.
function splitsFromInstance(xml) {
  const ctx = durationContexts(xml);
  const usd = usdUnits(xml);
  const fyFocus = (xml.match(/<dei:DocumentFiscalYearFocus\b[^>]*>\s*(\d{4})\s*</) || [])[1] || null;
  for (const concept of REVENUE_CONCEPTS) {
    const facts = numericFacts(xml, 'us-gaap', concept).filter((f) => !f.unit || usd.has(f.unit));
    // The fiscal-year total: undimensioned, ~one year long, the latest end.
    const totals = facts.filter((f) => { const c = ctx[f.ctx]; return c && c.start && c.end && !c.members.length && !c.typed && days(c.start, c.end) > 350 && days(c.start, c.end) < 380; });
    if (!totals.length) continue;
    const end = totals.map((f) => ctx[f.ctx].end).sort().pop();
    const totalFact = totals.find((f) => ctx[f.ctx].end === end);
    const start = ctx[totalFact.ctx].start;
    const total = totalFact.val;
    if (!(total > 0)) continue;
    const byAxis = {};
    const seen = new Set();
    for (const f of facts) {
      const c = ctx[f.ctx];
      if (!c || c.typed || c.members.length !== 1 || c.start !== start || c.end !== end) continue;
      const { dimension, member } = c.members[0];
      const key = `${dimension}|${member}`;
      if (seen.has(key)) continue;   // the same fact tagged twice in the inline document
      seen.add(key);
      (byAxis[dimension] = byAxis[dimension] || []).push({ member, label: humanize(member), value: f.val });
    }
    const axes = Object.entries(byAxis).map(([axis, members]) => {
      const sum = members.reduce((s, x) => s + x.value, 0);
      const ties = members.length >= 2 && Math.abs(sum - total) <= TIE * total;
      return { axis, label: axisLabel(axis), members: members.sort((a, b) => b.value - a.value), sum, ties, splittable: !NOT_A_SPLIT.has(axis) };
    });
    return { fy: fyFocus || end.slice(0, 4), end, start, concept: `us-gaap:${concept}`, total, axes };
  }
  return null;
}

const isCustom = (axis) => !/^(us-gaap|srt|dei|country|currency|exch|naics|sic|stpr):/.test(axis);

// Pure: one box's split from the evaluated axes, or { ok: false, reason }.
function pickBox(found, kind, form) {
  if (!found) return { ok: false, reason: 'no fiscal-year revenue total tagged in the 10-K' };
  const order = kind === 'geo' ? GEO_AXES : PRODUCT_AXES;
  const eligible = found.axes.filter((a) => a.splittable && (order.includes(a.axis) || (kind === 'product' && isCustom(a.axis))));
  const rank = (a) => (order.includes(a.axis) ? order.indexOf(a.axis) : order.length);
  const tying = eligible.filter((a) => a.ties).sort((a, b) => rank(a) - rank(b));
  if (!tying.length) {
    return { ok: false, reason: eligible.length ? `no ${kind === 'geo' ? 'geographic' : 'product/segment'} axis in the 10-K sums to filed revenue within 0.5%` : `the 10-K tags no ${kind === 'geo' ? 'geographic' : 'product/segment'} revenue split`,
      checked: eligible.map((a) => ({ axis: a.axis, sum: a.sum, total: found.total, members: a.members.length })) };
  }
  const a = tying[0];
  return {
    ok: true, source: 'sec', year: String(found.fy), form, axis: a.axis, axisLabel: a.label, concept: found.concept,
    total: found.total, sum: a.sum, period: { start: found.start, end: found.end },
    label: `SEC 10-K FY${found.fy}, ${a.label}`,
    segments: a.members.map((m) => ({ label: m.label, member: m.member, value: m.value })),
  };
}

// The two boxes for one CIK. Never throws.
async function revenueSplit(cik) {
  try {
    const sub = await readSubmissions(cik);
    const tenK = latestTenK(sub);
    if (!tenK) return { product: { ok: false, reason: 'no 10-K on file' }, geo: { ok: false, reason: 'no 10-K on file' } };
    const xml = await readInstanceXml(cik, tenK);
    if (!xml) return { product: { ok: false, reason: 'the 10-K XBRL instance could not be read' }, geo: { ok: false, reason: 'the 10-K XBRL instance could not be read' } };
    const found = splitsFromInstance(xml);
    const filing = { accn: tenK.accn, filed: tenK.filed, reportDate: tenK.reportDate };
    return { filing, product: pickBox(found, 'product', tenK.form), geo: pickBox(found, 'geo', tenK.form),
      axes: found ? found.axes.map((a) => ({ axis: a.axis, sum: a.sum, ties: a.ties, members: a.members })) : [], total: found ? found.total : null, concept: found ? found.concept : null };
  } catch (e) {
    return { product: { ok: false, reason: `10-K read failed: ${e.message}` }, geo: { ok: false, reason: `10-K read failed: ${e.message}` } };
  }
}

module.exports = { revenueSplit, splitsFromInstance, pickBox, latestTenK, humanize, durationContexts, TIE };
