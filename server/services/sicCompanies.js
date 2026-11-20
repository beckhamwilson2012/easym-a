'use strict';
// EDGAR registrants by 4-digit SIC: the peer picker's same-SIC candidates (Fix 24). Read from EDGAR's own company list
// (browse-edgar, Atom output, 100 per page). The SIC on each entry is EDGAR's, the same field the submissions JSON and the
// app's SIC cache carry. The list includes registrants that no longer trade; the picker keeps only those with a current
// ticker in company_tickers.json that are on FMP's screen of US-listed companies, so dead entries fall out there.
//
// Paced (one request at a time, PACE_MS apart: well under EDGAR's 10 requests a second) and cached per SIC for 24h. A
// failure is never cached and never becomes "no companies": it throws, and the picker says the list was unavailable.

const PAGE = 100;
const MAX_PAGES = 60;          // 6,000 registrants; no SIC code is that large
const PACE_MS = 150;
const TTL_MS = 24 * 60 * 60 * 1000;

const urlFor = (sic, start) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=${encodeURIComponent(sic)}&owner=include&count=${PAGE}&start=${start}&output=atom`;

// CIKs of the <entry> blocks whose <sic> is the one asked for.
function parseSicPage(xml, sic) {
  const out = [];
  const entries = String(xml || '').split('<entry>').slice(1);
  for (const e of entries) {
    const cik = (e.match(/<cik>(\d+)<\/cik>/) || [])[1];
    const s = (e.match(/<sic>(\d+)<\/sic>/) || [])[1];
    if (cik && (!s || s === String(sic))) out.push(cik.padStart(10, '0'));
  }
  return { ciks: out, entries: entries.length };
}

function createSicCompanies({ getText, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cache = new Map(); // sic → { ts, ciks }
  let last = 0;
  let chain = Promise.resolve();
  const paced = (fn) => {
    const run = chain.then(async () => {
      const wait = last + PACE_MS - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };

  async function ciksForSic(sic) {
    const code = String(sic || '');
    if (!/^\d{4}$/.test(code)) return [];
    const hit = cache.get(code);
    if (hit && now() - hit.ts < TTL_MS) return hit.ciks;
    const ciks = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const xml = await paced(() => getText(urlFor(code, p * PAGE)));
      if (!/<feed[\s>]/.test(String(xml || ''))) throw new Error('EDGAR company list: not an Atom feed');
      const page = parseSicPage(xml, code);
      ciks.push(...page.ciks);
      if (page.entries < PAGE) {
        cache.set(code, { ts: now(), ciks });
        return ciks;
      }
    }
    throw new Error(`EDGAR company list for SIC ${code} longer than ${MAX_PAGES * PAGE} entries`);
  }

  return { ciksForSic };
}

module.exports = { createSicCompanies, parseSicPage, urlFor };
