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

const { latestPeriodicFiling, readInstanceXml, readPrimaryDocument, readSubmissions, parseContexts, numericFacts } = require('./filingInstance');

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
  return { date, classes, undimensioned, epsMembers: epsClassMembers(xml, contexts) };
}

// ── Classes with no economic stake (Fix 7b Task 8) ──
// An Up-C filer (ASTS) reports voting-only classes on its cover: Class B and Class C "are non-economic" and "do not
// participate in the earnings or losses of the Company"; their holders' economics sit in operating-company units.
// Such a class is not part of the equity a market cap prices, so it is left out of the count. Two filed signals are
// required, never one:
//   (1) the XBRL reports EPS by class (an EPS fact on the class-of-stock axis) and reports none for this class; and
//   (2) the filing's own text calls this class non-economic / not participating in earnings.
// A filer that reports one combined EPS (HNGE, SDGR, ECHO) or EPS for every class (NET, DDOG, HSY) keeps every class.
// The holders' economic units are not added: no filing read so far gives a count for them, and none is estimated.
const EPS_CONCEPTS = ['EarningsPerShareBasic', 'EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'];
const NON_ECONOMIC = /non-economic|no economic rights|do(?:es)? not participate in (?:the )?(?:earnings|net income|net loss)/i;

// Pure: the class members the filing reports EPS for. Empty when its EPS carries no class dimension.
function epsClassMembers(xml, contexts) {
  const out = new Set();
  for (const name of EPS_CONCEPTS) {
    for (const f of numericFacts(xml, 'us-gaap', name)) {
      const c = contexts[f.ctx];
      if (!c) continue;
      for (const m of c.members) if (m.dimension.split(':').pop() === CLASS_AXIS) out.add(m.member);
    }
  }
  return [...out];
}

// Pure: plain text of a filing → the class letters its own sentences call non-economic. { B: 'sentence', ... }
function nonEconomicClassesInText(text) {
  const out = {};
  for (const s of String(text || '').split(/(?<=[.;])\s+/)) {
    if (!NON_ECONOMIC.test(s)) continue;
    for (const m of s.matchAll(/\bClass ([A-Z])\b/g)) if (!out[m[1]]) out[m[1]] = s.trim().slice(0, 300);
  }
  return out;
}

// Pure: cover classes → { kept, excluded }. `text` is the filing's plain text, or null when it was not read.
function economicClasses(parsed, text) {
  const eps = new Set(parsed.epsMembers || []);
  const none = { kept: parsed.classes, excluded: [] };
  if (!eps.size || !text) return none;
  const said = nonEconomicClassesInText(text);
  const letter = (c) => (c.label.match(/^Class ([A-Z])$/) || [])[1];
  const excluded = parsed.classes.filter((c) => !eps.has(c.member) && letter(c) && said[letter(c)]);
  if (!excluded.length || excluded.length === parsed.classes.length) return none;
  return { kept: parsed.classes.filter((c) => !excluded.includes(c)), excluded };
}

// True when the cover has a class the XBRL reports no EPS for while it reports EPS for others: the only case the
// filing's text is read for (one extra cached request, for that filer only).
function needsEconomicCheck(parsed) {
  const eps = new Set((parsed && parsed.epsMembers) || []);
  return !!parsed && eps.size > 0 && parsed.classes.length >= 2 && parsed.classes.some((c) => !eps.has(c.member));
}

// Pure: parsed cover + filing → the summed count with its label, or { value: null, reason }. `split` (economicClasses)
// leaves out voting-only classes; without it every class counts, as before.
function sumCoverClasses(parsed, filing, split = null) {
  if (!parsed) return { value: null, reason: 'filing instance unreadable' };
  if (parsed.classes.length < 2) return { value: null, reason: `cover reports ${parsed.classes.length} share class(es); not a multi-class cover` };
  const kept = split ? split.kept : parsed.classes;
  const excluded = split ? split.excluded : [];
  const value = kept.reduce((s, x) => s + x.shares, 0);
  const label = `${kept.map((x) => x.label).join(' + ')}, cover of ${filing.form} filed ${filing.filed}`
    + (excluded.length ? `; ${excluded.map((x) => x.label).join(' and ')} excluded: non-economic (no share of earnings or dividends, per the ${filing.form})` : '');
  return { value, date: parsed.date, label, form: filing.form, filed: filing.filed, accn: filing.accn, classes: kept, excludedClasses: excluded };
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

// The filing's primary document as plain text (same decoding as debtZero), or null when it can't be read.
async function readFilingText(cik, filing) {
  const html = await readPrimaryDocument(cik, filing);
  if (!html) return null;
  const decode = (s) => s.replace(/&#160;|&nbsp;/g, ' ').replace(/&#x2019;|&#8217;/gi, "'").replace(/&amp;/g, '&');
  return decode(html).replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
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
    // Voting-only classes (Fix 7b): read the filing's text only when the XBRL already singles a class out.
    const text = needsEconomicCheck(parsed) ? await (deps.readText || readFilingText)(cik, filing) : null;
    const r = sumCoverClasses(parsed, filing, parsed ? economicClasses(parsed, text) : null);
    return r.value != null ? r : null;
  } catch (e) {
    console.error(`[coverShares] CIK ${cik}: ${e.message}`);
    return null;
  }
}

module.exports = { classLabel, parseCoverShares, sumCoverClasses, latestPeriodicFiling, coverInCompanyFacts, multiClassCoverShares,
  epsClassMembers, nonEconomicClassesInText, economicClasses, needsEconomicCheck };
