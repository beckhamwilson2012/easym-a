'use strict';
// server/services/filingInstance.js — the latest periodic filing and its own XBRL instance, read once per accession.
// companyfacts keeps only undimensioned facts; a filing's instance holds everything it tagged, including class-dimensioned
// cover counts (coverShares) and facility-dimensioned debt and the debt note's text block (debtZero). One reader, one cache.
// Never throws: an unreadable filing is null and the caller keeps its existing value with the reason.

const UA = { 'User-Agent': 'EasyMandA contact@easymanda.com' };
const TIMEOUT_MS = 20000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const PERIODIC_FORMS = ['10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT'];

// The latest periodic filing from a submissions payload: { form, accn, filed, reportDate, primaryDocument } or null.
function latestPeriodicFiling(sub) {
  const r = sub && sub.filings && sub.filings.recent;
  if (!r || !r.form) return null;
  let best = null;
  r.form.forEach((form, i) => {
    if (!PERIODIC_FORMS.includes(form)) return;
    const f = { form, accn: r.accessionNumber[i], filed: r.filingDate[i], reportDate: r.reportDate[i], primaryDocument: r.primaryDocument ? r.primaryDocument[i] : null };
    if (!best || f.filed > best.filed) best = f;
  });
  return best;
}

async function readText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const folderOf = (cik, accn) => `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${String(accn).replace(/-/g, '')}`;

function cached(map, key, load, tag) {
  const hit = map.get(key);
  if (hit && (!hit.failed || Date.now() - hit.ts < FAILURE_RETRY_MS)) return hit.promise;
  const promise = load().catch((e) => {
    console.error(`[filingInstance] ${tag} read failed for ${key}: ${e.message}`);
    map.set(key, { promise: Promise.resolve(null), failed: true, ts: Date.now() });
    return null;
  });
  map.set(key, { promise, failed: false, ts: Date.now() });
  return promise;
}

const instanceCache = new Map();   // accession → instance XML text. A filing never changes, so success has no TTL.
const documentCache = new Map();   // accession → primary document HTML
const namesCache = new Map();      // accession → file names in the filing folder
const presentationCache = new Map(); // accession → presentation linkbase XML

function readFolderNames(cik, filing) {
  return cached(namesCache, filing.accn, async () => (JSON.parse(await readText(`${folderOf(cik, filing.accn)}/index.json`)).directory?.item || []).map((i) => i.name), 'index');
}

function readInstanceXml(cik, filing) {
  return cached(instanceCache, filing.accn, async () => {
    const names = await readFolderNames(cik, filing);
    if (!names) throw new Error('the filing index could not be read');
    const instance = names.find((n) => /_htm\.xml$/.test(n))
      || names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/i.test(n));
    if (!instance) throw new Error('no XBRL instance in the filing');
    return readText(`${folderOf(cik, filing.accn)}/${instance}`);
  }, 'instance');
}

// The filing's presentation linkbase (which concepts sit on which statement, in order), or null. debtZero reads the
// balance sheet's liability lines from it.
function readPresentationXml(cik, filing) {
  return cached(presentationCache, filing.accn, async () => {
    const names = await readFolderNames(cik, filing);
    if (!names) throw new Error('the filing index could not be read');
    const pre = names.find((n) => /_pre\.xml$/.test(n));
    if (!pre) throw new Error('no presentation linkbase in the filing');
    return readText(`${folderOf(cik, filing.accn)}/${pre}`);
  }, 'presentation');
}

function readPrimaryDocument(cik, filing) {
  if (!filing.primaryDocument) return Promise.resolve(null);
  return cached(documentCache, filing.accn, () => readText(`${folderOf(cik, filing.accn)}/${filing.primaryDocument}`), 'document');
}

// The same submissions read (and cache) incomeConcepts already makes for every /quote: no extra request per filer.
const readSubmissions = (cik) => require('./incomeConcepts').submissions(cik);

// Pure: contexts of an instance → { id: { instant, members: [{ dimension, member }] } }.
function parseContexts(xml) {
  const contexts = {};
  for (const m of xml.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g)) {
    const body = m[2];
    const instant = (body.match(/<(?:xbrli:)?instant>\s*([0-9-]+)\s*</) || [])[1] || null;
    const members = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]+)\s*</g)].map((x) => ({ dimension: x[1], member: x[2] }));
    // Any dimension at all, explicit or typed: a balance-sheet line is the context with none.
    const dimensioned = /<xbrldi:(?:explicit|typed)Member\b/.test(body);
    contexts[m[1]] = { instant, members, dimensioned };
  }
  return contexts;
}

// Pure: every numeric fact of `prefix:name` → [{ ctx, val, unit, decimals }].
function numericFacts(xml, prefix, name) {
  return [...xml.matchAll(new RegExp(`<${prefix}:${name}\\b([^>]*)>\\s*(-?[0-9.]+)\\s*<`, 'g'))]
    .map((m) => ({
      ctx: (m[1].match(/contextRef="([^"]+)"/) || [])[1], val: Number(m[2]),
      unit: (m[1].match(/unitRef="([^"]+)"/) || [])[1] || null, decimals: (m[1].match(/decimals="([^"]+)"/) || [])[1] ?? null,
    }))
    .filter((f) => f.ctx && Number.isFinite(f.val));
}

// Pure: unit ids whose single measure is iso4217:USD.
function usdUnits(xml) {
  const ids = new Set();
  for (const m of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measures = [...m[2].matchAll(/<(?:xbrli:)?measure>\s*([^<\s]+)\s*</g)].map((x) => x[1]);
    if (measures.length === 1 && measures[0] === 'iso4217:USD') ids.add(m[1]);
  }
  return ids;
}

module.exports = { latestPeriodicFiling, readInstanceXml, readPrimaryDocument, readPresentationXml, readSubmissions, parseContexts, numericFacts, usdUnits };
