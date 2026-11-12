'use strict';
// server/services/coverShares.js — shares outstanding for a filer whose cover page reports them BY CLASS.
//
// A dual-class filer tags dei:EntityCommonStockSharesOutstanding once per class, each fact on a context dimensioned by
// us-gaap:StatementClassOfStockAxis. companyfacts keeps only undimensioned facts, so for these filers it carries no cover
// count at all and the /quote resolver fell through to a fiscal-year WEIGHTED AVERAGE (HNGE: 54.6M against 81.3M on its
// Q3 2026 cover). The count is read from the latest 10-K/10-Q's own XBRL instance instead:
//   - every class fact on the SAME cover date, from that ONE filing, summed;
//   - never mixed with a weighted average or another filing's count;
//   - two or more distinct classes required. A single-class filer that happens to dimension its one class keeps the
//     existing resolution, untouched.
// Nothing here estimates. An unreadable filing, or a cover with fewer than two classes, returns null with the reason,
// and the caller keeps its existing chain.

const UA = { 'User-Agent': 'EasyMandA contact@easymanda.com' };
const TIMEOUT_MS = 20000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const COVER_CONCEPT = 'EntityCommonStockSharesOutstanding';
const CLASS_AXIS = 'StatementClassOfStockAxis';
const PERIODIC_FORMS = ['10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT'];

// "us-gaap:CommonClassAMember" → "Class A"; "hnge:SeriesOneCommonStockMember" → "Series One Common Stock".
function classLabel(member) {
  const local = String(member).split(':').pop().replace(/Member$/, '');
  const m = local.match(/^CommonClass([A-Z0-9]+)$/);
  if (m) return `Class ${m[1]}`;
  return local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim();
}

// Pure: an XBRL instance → the cover-page class facts. { date, classes: [{ member, label, shares }], undimensioned }
// `date` is the latest instant carrying a class fact; `classes` are the class facts on that date only.
function parseCoverShares(xml) {
  const contexts = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    const instant = (body.match(/<(?:xbrli:)?instant>\s*([0-9-]+)\s*</) || [])[1] || null;
    const members = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((x) => ({ dimension: x[1], member: x[2] }));
    contexts[m[1]] = { instant, members };
  }
  const facts = [...xml.matchAll(new RegExp(`<dei:${COVER_CONCEPT}\\b([^>]*)>\\s*([0-9.]+)\\s*<`, 'g'))].map((m) => ({
    ctx: (m[1].match(/contextRef="([^"]+)"/) || [])[1], val: Number(m[2]),
  })).filter((f) => f.ctx && contexts[f.ctx] && Number.isFinite(f.val));

  let undimensioned = null;
  const byClass = [];
  for (const f of facts) {
    const c = contexts[f.ctx];
    if (!c.members.length) { undimensioned = { shares: f.val, date: c.instant }; continue; }
    // A class fact: exactly one member, on the class-of-stock axis. Any other dimension (e.g. a co-registrant) is not a class.
    if (c.members.length === 1 && c.members[0].dimension.split(':').pop() === CLASS_AXIS && c.instant) {
      byClass.push({ member: c.members[0].member, label: classLabel(c.members[0].member), shares: f.val, date: c.instant });
    }
  }
  const date = byClass.reduce((d, x) => (x.date > d ? x.date : d), '') || null;
  const onDate = byClass.filter((x) => x.date === date);
  const seen = new Set();
  const classes = onDate.filter((x) => (seen.has(x.member) ? false : seen.add(x.member)));
  return { date, classes, undimensioned };
}

// Pure: parsed cover + filing → the summed count with its label, or { value: null, reason }.
function sumCoverClasses(parsed, filing) {
  if (!parsed) return { value: null, reason: 'filing instance unreadable' };
  if (parsed.classes.length < 2) return { value: null, reason: `cover reports ${parsed.classes.length} share class(es); not a multi-class cover` };
  const value = parsed.classes.reduce((s, x) => s + x.shares, 0);
  const label = `${parsed.classes.map((x) => x.label).join(' + ')}, cover of ${filing.form} filed ${filing.filed}`;
  return { value, date: parsed.date, label, form: filing.form, filed: filing.filed, accn: filing.accn, classes: parsed.classes };
}

// The latest periodic filing from a submissions payload: { form, accn, filed, reportDate } or null.
function latestPeriodicFiling(sub) {
  const r = sub && sub.filings && sub.filings.recent;
  if (!r || !r.form) return null;
  let best = null;
  r.form.forEach((form, i) => {
    if (!PERIODIC_FORMS.includes(form)) return;
    const f = { form, accn: r.accessionNumber[i], filed: r.filingDate[i], reportDate: r.reportDate[i] };
    if (!best || f.filed > best.filed) best = f;
  });
  return best;
}

// True when companyfacts already carries an undimensioned cover count from that filing: the single-class case, where
// the existing resolver is right and nothing here runs.
function coverInCompanyFacts(dei, filing) {
  const rows = dei && dei[COVER_CONCEPT] && dei[COVER_CONCEPT].units && dei[COVER_CONCEPT].units.shares;
  return !!(rows && filing && rows.some((e) => e.accn === filing.accn));
}

async function readText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const cache = new Map();   // accession → { promise, failed, ts }. A filing never changes, so success has no TTL.

// The same submissions read (and cache) incomeConcepts already makes for every /quote: no extra request per filer.
const readSubmissions = (cik) => require('./incomeConcepts').submissions(cik);

async function readCover(cik, filing) {
  const cached = cache.get(filing.accn);
  if (cached && (!cached.failed || Date.now() - cached.ts < FAILURE_RETRY_MS)) return cached.promise;
  const promise = (async () => {
    const folder = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${filing.accn.replace(/-/g, '')}`;
    const names = (JSON.parse(await readText(`${folder}/index.json`)).directory?.item || []).map((i) => i.name);
    const instance = names.find((n) => /_htm\.xml$/.test(n))
      || names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/i.test(n));
    if (!instance) throw new Error('no XBRL instance in the filing');
    return parseCoverShares(await readText(`${folder}/${instance}`));
  })().catch((e) => {
    console.error(`[coverShares] read failed for ${filing.accn}: ${e.message}`);
    cache.set(filing.accn, { promise: Promise.resolve(null), failed: true, ts: Date.now() });
    return null;
  });
  cache.set(filing.accn, { promise, failed: false, ts: Date.now() });
  return promise;
}

// The one entry point (/quote and §16 both call it). Returns { value (raw shares), date, label, ... } for a multi-class
// cover, or null: single-class (companyfacts has the cover count), no periodic filing, unreadable, or < 2 classes.
// Never throws.
async function multiClassCoverShares(cik, dei, deps = {}) {
  try {
    const sub = await (deps.readSubmissions || readSubmissions)(cik);
    const filing = latestPeriodicFiling(sub);
    if (!filing || coverInCompanyFacts(dei, filing)) return null;
    const parsed = await (deps.readCover || readCover)(cik, filing);
    const r = sumCoverClasses(parsed, filing);
    return r.value != null ? r : null;
  } catch (e) {
    console.error(`[coverShares] CIK ${cik}: ${e.message}`);
    return null;
  }
}

module.exports = { classLabel, parseCoverShares, sumCoverClasses, latestPeriodicFiling, coverInCompanyFacts, multiClassCoverShares };
