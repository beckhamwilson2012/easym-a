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

const { latestPeriodicFiling, readInstanceXml, readSubmissions, parseContexts, numericFacts } = require('./filingInstance');

const COVER_CONCEPT = 'EntityCommonStockSharesOutstanding';
const CLASS_AXIS = 'StatementClassOfStockAxis';
const NOT_COMMON = /preferred|warrant|right|unit|note|debenture|depositary|convertible/i;

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
  const contexts = parseContexts(xml);
  const facts = numericFacts(xml, 'dei', COVER_CONCEPT).filter((f) => contexts[f.ctx]);

  let undimensioned = null;
  const byClass = [];
  for (const f of facts) {
    const c = contexts[f.ctx];
    if (!c.members.length) { undimensioned = { shares: f.val, date: c.instant }; continue; }
    // A class fact: exactly one member, on the class-of-stock axis. Any other dimension (e.g. a co-registrant) is not a class.
    // Common stock only: GSAT tags its preferred (us-gaap:PreferredStockMember, 149,425 shares) under the same cover
    // concept, and preferred is not common stock, so it never enters the count or the market cap.
    if (c.members.length === 1 && c.members[0].dimension.split(':').pop() === CLASS_AXIS && c.instant
      && !NOT_COMMON.test(c.members[0].member.split(':').pop())) {
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

// True when companyfacts already carries an undimensioned cover count from that filing: the single-class case, where
// the existing resolver is right and nothing here runs.
function coverInCompanyFacts(dei, filing) {
  const rows = dei && dei[COVER_CONCEPT] && dei[COVER_CONCEPT].units && dei[COVER_CONCEPT].units.shares;
  return !!(rows && filing && rows.some((e) => e.accn === filing.accn));
}

async function readCover(cik, filing) {
  const xml = await readInstanceXml(cik, filing);
  return xml ? parseCoverShares(xml) : null;
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
