// server/services/classifierAgent.js
// Phase 9 of the document pipeline: the SECTOR CLASSIFIER agent (Haiku, ONE cheap call per document).
//
// A private company has no ticker, so the SIC/sector that the ticker flow reads from EDGAR is absent.
// This agent recovers a sector from the filing's OWN business description — the "Item 1. Business" prose
// — and nothing else. It is a CLASSIFIER, not an appraiser: it returns a sector label + the matching SIC
// and never sees, picks, or touches a multiple or any financial figure. The valuation arithmetic
// (multiple × EBITDA, net debt, equity value) is done later, in JS, on numbers the extractor sourced to
// page cites — never here.
//
// The returned SIC is deliberately one of the SECTOR_PEERS keys in server.js, so peer resolution reuses
// the SAME sectorPoolForSic() the ticker flow uses — no second source of peer data. A filing it cannot
// confidently place returns sector 'other' / sic null, which makes the peer step fail LOUDLY (the caller
// surfaces it and asks the user for a multiple). There is deliberately no "default sector".

const https = require('https');

const HAIKU_MODEL = 'claude-haiku-4-5';
const HEAD_CHARS  = 500;                        // per-page prose cap fed to the model (business description, not numbers)
const MAX_PAGES   = 12;                         // front-matter window — Item 1 "Business" lives here
const PRICE       = { input: 1.0, output: 5.0 }; // Haiku 4.5 $/1M tokens (in / out)

// The enum the model chooses from. Each sector maps to ONE SIC that is a real key in server.js's
// SECTOR_PEERS table — so a classification resolves peers through the existing sectorPoolForSic(). Keep
// these SICs in sync with SECTOR_PEERS; 'other' (sic:null) is the honest no-confident-match escape hatch.
const SECTORS = [
  { sector: 'beverages',          sic: '2080', hint: 'soft drinks, bottling, alcoholic or non-alcoholic beverages' },
  { sector: 'packaged food',      sic: '2000', hint: 'packaged/processed foods, snacks, confectionery' },
  { sector: 'pharmaceuticals',    sic: '2834', hint: 'drug development, pharmaceutical preparations, biotech therapeutics' },
  { sector: 'oil & gas',          sic: '2911', hint: 'petroleum refining, oil & gas exploration/production' },
  { sector: 'semiconductors',     sic: '3674', hint: 'chips, semiconductors, integrated circuits, foundry' },
  { sector: 'automotive',         sic: '3711', hint: 'motor vehicles, automakers, EV manufacturers' },
  { sector: 'general retail',     sic: '5331', hint: 'general-merchandise / big-box / discount / grocery retail chains' },
  { sector: 'specialty retail',   sic: '5734', hint: 'computer/electronics/specialty-goods retail' },
  { sector: 'banking',            sic: '6022', hint: 'commercial banks, deposit-taking institutions, lenders' },
  { sector: 'software',           sic: '7372', hint: 'prepackaged/enterprise/SaaS software' },
  { sector: 'restaurants',        sic: '5812', hint: 'restaurants, eating & drinking places, food service' },
];
const SIC_BY_SECTOR = Object.fromEntries(SECTORS.map(s => [s.sector, s.sic]));

// Build a business-description digest: the front matter of the filing (cover + Item 1 "Business"), where
// what the company DOES is described. We take the head of the first MAX_PAGES pages (whitespace-collapsed).
// We never send financial-statement pages — the classifier's job is the prose, not the numbers.
function buildBusinessDigest(pages) {
  return (pages || [])
    .slice(0, MAX_PAGES)
    .map(p => `P${p.page}: ${String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, HEAD_CHARS)}`)
    .join('\n');
}

const SYSTEM = `You classify a company into ONE industry sector, reading ONLY the business-description prose from the front of its SEC filing (the cover and "Item 1. Business"). You are a classifier, not an analyst: you never estimate value, pick a multiple, or read financial numbers.

Choose exactly one sector from the allowed list by what the company primarily DOES (its products/services and industry). If the prose does not let you place it CONFIDENTLY into one of the listed sectors, return sector "other" — do NOT force a weak match. "other" is the correct, honest answer for anything outside the list.

Allowed sectors (label — what it covers):
${SECTORS.map(s => `- ${s.sector} — ${s.hint}`).join('\n')}
- other — none of the above fit confidently

Call classify_sector with the sector label, your confidence (high/medium/low), and a one-line rationale quoting the descriptive phrase you keyed on. Do not output any financial figure.`;

const TOOL = {
  name: 'classify_sector',
  description: 'Report the single best-fit industry sector from the allowed list, based ONLY on the business-description prose.',
  input_schema: {
    type: 'object',
    properties: {
      sector:     { type: 'string', enum: [...SECTORS.map(s => s.sector), 'other'], description: 'The single best-fit sector, or "other" if none fit confidently.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How confident the classification is, from the prose alone.' },
      rationale:  { type: 'string', description: 'One line: the descriptive phrase from the filing you keyed on (no numbers).' },
    },
    required: ['sector', 'confidence', 'rationale'],
  },
};

// Raw HTTPS call to the Messages API, forcing classify_sector (matches locatorAgent / server.js no-SDK style).
function callHaiku(userText) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const body = JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'classify_sector' },
      messages: [{ role: 'user', content: userText }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Anthropic HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Anthropic response not JSON')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Classify the business described in a Phase-1 `pages` array. Returns { ok, sector, sic, confidence,
// rationale, model, usage, costUsd }. sic is null for 'other' (or an unlisted sector) — the caller MUST
// treat a null sic as "no peer set derivable → ask the user", never as a default. Never throws for a
// low-confidence result; only a transport/parse failure rejects.
async function classifySector(pages) {
  const digest = buildBusinessDigest(pages);
  const userText = `Business-description prose from the front of one SEC filing (page: head text):\n\n${digest}`;

  const resp = await callHaiku(userText);
  const block = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'classify_sector');
  if (!block) throw new Error('Classifier: model did not return the classify_sector tool call');
  const out = block.input || {};

  const usage = resp.usage || {};
  const costUsd = (usage.input_tokens || 0) / 1e6 * PRICE.input + (usage.output_tokens || 0) / 1e6 * PRICE.output;

  const sector = out.sector || 'other';
  const sic = SIC_BY_SECTOR[sector] || null;   // 'other' or any off-list value → null (no peer set)
  return {
    ok: true,
    sector,
    sic,
    confidence: out.confidence || 'low',
    rationale: String(out.rationale || '').slice(0, 240),
    model: HAIKU_MODEL,
    usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
    costUsd,
  };
}

module.exports = { classifySector, buildBusinessDigest, SECTORS, SIC_BY_SECTOR, HAIKU_MODEL };
