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

function readInstanceXml(cik, filing) {
  return cached(instanceCache, filing.accn, async () => {
    const folder = folderOf(cik, filing.accn);
    const names = (JSON.parse(await readText(`${folder}/index.json`)).directory?.item || []).map((i) => i.name);
    const instance = names.find((n) => /_htm\.xml$/.test(n))
      || names.find((n) => /\.xml$/.test(n) && !/(_cal|_def|_lab|_pre)\.xml$|FilingSummary/i.test(n));
    if (!instance) throw new Error('no XBRL instance in the filing');
    return readText(`${folder}/${instance}`);
  }, 'instance');
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
    contexts[m[1]] = { instant, members };
  }
  return contexts;
}

// Pure: every numeric fact of `prefix:name` → [{ ctx, val }].
function numericFacts(xml, prefix, name) {
  return [...xml.matchAll(new RegExp(`<${prefix}:${name}\\b([^>]*)>\\s*(-?[0-9.]+)\\s*<`, 'g'))]
    .map((m) => ({ ctx: (m[1].match(/contextRef="([^"]+)"/) || [])[1], val: Number(m[2]) }))
    .filter((f) => f.ctx && Number.isFinite(f.val));
}

module.exports = { latestPeriodicFiling, readInstanceXml, readPrimaryDocument, readSubmissions, parseContexts, numericFacts };
