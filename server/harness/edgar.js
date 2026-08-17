// server/harness/edgar.js — Phase 6 truth-harness support: fetch a real 10-K from EDGAR, render it to
// PDF the same way a browser print-to-PDF does (headless Chrome), and pull XBRL "truth" from
// data.sec.gov/companyfacts. NO app logic here — this only PRODUCES inputs + ground truth for the gate.
const fs = require('fs');
const { execFileSync } = require('child_process');

const UA = 'EasyMA-Research beckhamwilson@gmail.com';   // SEC requires a declared User-Agent
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function curlJson(url) {
  const out = execFileSync('curl', ['-s', '-m', '40', '-A', UA, url], { maxBuffer: 512 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8'));
}

function cikFor(ticker) {
  const map = curlJson('https://www.sec.gov/files/company_tickers.json');
  for (const k in map) if (String(map[k].ticker).toUpperCase() === ticker.toUpperCase()) return String(map[k].cik_str).padStart(10, '0');
  throw new Error(`ticker not found: ${ticker}`);
}

// most recent 10-K (skip 10-K/A amendments)
function latestTenK(cik) {
  const s = curlJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = s.filings.recent;
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '10-K') {
      return {
        cik, company: s.name,
        accession: r.accessionNumber[i].replace(/-/g, ''),
        primaryDoc: r.primaryDocument[i],
        filingDate: r.filingDate[i],
        reportDate: r.reportDate[i],   // fiscal period end
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`,
      };
    }
  }
  throw new Error(`no 10-K found for CIK ${cik}`);
}

// Render a URL to PDF via headless Chrome — the browser print-to-PDF path (same as the reference file).
function renderPdf(url, outPath) {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-agent=${UA}`,   // SEC blocks Chrome's default headless UA — declare traffic like curl does
    '--virtual-time-budget=45000', '--run-all-compositor-stages-before-draw',
    `--print-to-pdf=${outPath}`, url,
  ], { timeout: 180000, stdio: 'ignore' });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 5000) throw new Error(`render produced no/empty PDF: ${outPath}`);
  return outPath;
}

function companyFacts(cik) { return curlJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }

module.exports = { cikFor, latestTenK, renderPdf, companyFacts, UA };
