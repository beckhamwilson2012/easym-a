// server/services/locatorAgent.js
// Phase 2 of the document pipeline: the LOCATOR agent (Haiku, ONE call per document).
//
// It is fed ONLY a compact digest — each page's number + the first 200 characters of that page
// (whitespace-collapsed). That 200-char cap IS the cost control and the safety boundary: the model
// physically cannot read the financial values or recompute anything, because it never sees them.
// Its whole job is to recognize STATEMENT TITLES in those heads and report which pages hold the
// primary consolidated Income / Balance Sheet / Cash Flow statements, plus document facts
// (scale, currency, fiscal year end).
//
// Hard guarantees enforced in CODE (not trusted to the model):
//   • pages the model returns that were not in the input digest are dropped (can't tag unseen pages);
//   • SCALE IS MANDATORY — if the document does not explicitly state "in millions"/"in thousands"/etc,
//     the locator REFUSES (ok:false, failure:'scale_not_stated'); it never guesses or defaults to units.

const https = require('https');

const HAIKU_MODEL = 'claude-haiku-4-5';
const HEAD_CHARS  = 200;                       // per-page input cap — the cost control; do NOT raise
const PRICE       = { input: 1.0, output: 5.0 }; // Haiku 4.5 $/1M tokens (in / out)
const VALID_SCALES = new Set(['millions', 'thousands', 'billions']);

// Build the heads-only digest: collapse whitespace FIRST (pdftotext -layout pads with spaces, which
// would otherwise eat the 200-char budget before reaching the title), then take the first 200 chars.
function buildHeads(pages) {
  return pages.map(p => ({
    page: p.page,
    head: String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, HEAD_CHARS),
  }));
}

const SYSTEM = `You are a LOCATOR for SEC financial filings. You receive, for ONE document, only each page's number and the first ~200 characters of that page (its "head"). You never see full pages. Your job: identify the pages that CONTAIN THE PRIMARY consolidated financial statements, by recognizing the statement TITLE in a page's head.

Rules:
- Classify a page ONLY by the statement title visible in its head:
  - incomeStatementPages - "Consolidated Statements of Income" / "...of Operations" / "...of Earnings". NOT "Comprehensive Income" (a different statement).
  - balanceSheetPages - "Consolidated Balance Sheets" / "Consolidated Statements of Financial Position".
  - cashFlowPages - "Consolidated Statements of Cash Flows".
- The PRIMARY statements appear once each (each may span at most 2 consecutive pages) and sit together in the financial-statements section. The NOTES and MD&A mention these titles constantly - a mention inside running text is NOT a statement page. A table-of-contents / index page that LISTS several statements is NOT a statement page. Prefer PRECISION: a handful of pages total, never dozens.
- Do NOT read, transcribe, or compute any financial numbers. Classify by title only.
- Do NOT tag any page number you were not given a head for.

Document facts (from the heads only):
- scaleStated: true ONLY if a head explicitly states the reporting scale (e.g. "(In millions, except per share amounts)" or "(in thousands)"). If no head states a scale, scaleStated=false.
- scale: "millions" | "thousands" | "billions" if explicitly stated; otherwise "unknown". NEVER guess or infer scale from how large the numbers look.
- currency: e.g. "USD" if stated or clearly indicated; otherwise "unknown".
- fiscalYearEnd: e.g. "December 31" if visible (e.g. "Year Ended December 31,"); otherwise "unknown".

Call report_structure. For every tagged page include an evidence entry with the exact TITLE text you saw (no numbers).`;

const TOOL = {
  name: 'report_structure',
  description: 'Report the primary-statement pages and document facts, based ONLY on the provided page heads.',
  input_schema: {
    type: 'object',
    properties: {
      incomeStatementPages: { type: 'array', items: { type: 'integer' }, description: 'Pages whose head shows the PRIMARY income/operations/earnings statement title (not comprehensive income, not notes).' },
      balanceSheetPages:    { type: 'array', items: { type: 'integer' }, description: 'Pages titled Consolidated Balance Sheets / Statements of Financial Position.' },
      cashFlowPages:        { type: 'array', items: { type: 'integer' }, description: 'Pages titled Consolidated Statements of Cash Flows.' },
      scaleStated: { type: 'boolean', description: 'True ONLY if a head explicitly states the reporting scale.' },
      scale:    { type: 'string', enum: ['millions', 'thousands', 'billions', 'units', 'unknown'], description: 'The explicitly stated scale, else "unknown". Never guess.' },
      currency: { type: 'string', description: 'Currency (e.g. "USD") if stated/clear, else "unknown".' },
      fiscalYearEnd: { type: 'string', description: 'Fiscal year end (e.g. "December 31") if visible, else "unknown".' },
      evidence: {
        type: 'array',
        description: 'One entry per tagged page: the exact statement TITLE text seen in its head. No numbers.',
        items: { type: 'object', properties: { page: { type: 'integer' }, title: { type: 'string' } }, required: ['page', 'title'] },
      },
    },
    required: ['incomeStatementPages', 'balanceSheetPages', 'cashFlowPages', 'scaleStated', 'scale', 'currency', 'fiscalYearEnd', 'evidence'],
  },
};

// Raw HTTPS call to the Messages API, forcing the report_structure tool (matches server.js's no-SDK style).
function callHaiku(userText) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const body = JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'report_structure' },
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

// Locate the primary statements in a Phase-1 `pages` array. Returns a structured result; on a
// missing scale it returns ok:false with an explicit failure (does NOT proceed / guess).
async function locateStatements(pages) {
  const heads = buildHeads(pages);
  const validPages = new Set(heads.map(h => h.page));
  const userText =
    `Document: ${heads.length} pages. For each page: its number and the first ${HEAD_CHARS} characters (the "head").\n\n` +
    heads.map(h => `P${h.page}: ${h.head}`).join('\n');

  const resp = await callHaiku(userText);
  const block = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'report_structure');
  if (!block) throw new Error('Locator: model did not return the report_structure tool call');
  const out = block.input || {};

  const usage = resp.usage || {};
  const costUsd = (usage.input_tokens || 0) / 1e6 * PRICE.input + (usage.output_tokens || 0) / 1e6 * PRICE.output;

  // CODE guard: keep only page numbers we actually gave the model a head for.
  const clean = (arr) => {
    const kept = [], dropped = [];
    for (const n of Array.isArray(arr) ? arr : []) (validPages.has(n) ? kept : dropped).push(n);
    return { kept: [...new Set(kept)].sort((a, b) => a - b), dropped };
  };
  const inc = clean(out.incomeStatementPages), bal = clean(out.balanceSheetPages), cf = clean(out.cashFlowPages);
  const droppedPages = [...inc.dropped, ...bal.dropped, ...cf.dropped];

  const facts = {
    scaleStated: out.scaleStated === true,
    scale: out.scale || 'unknown',
    currency: out.currency || 'unknown',
    fiscalYearEnd: out.fiscalYearEnd || 'unknown',
  };

  const base = {
    incomeStatementPages: inc.kept,
    balanceSheetPages: bal.kept,
    cashFlowPages: cf.kept,
    facts,
    evidence: Array.isArray(out.evidence) ? out.evidence.filter(e => validPages.has(e.page)) : [],
    model: HAIKU_MODEL,
    usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
    costUsd,
    digestChars: userText.length,
    droppedPages,
  };

  // MANDATORY scale gate: refuse if the document did not explicitly state a usable scale.
  if (!facts.scaleStated || !VALID_SCALES.has(facts.scale)) {
    return { ok: false, failure: 'scale_not_stated',
      reason: 'Document does not explicitly state its reporting scale (in millions/thousands). Refusing to proceed rather than guess.',
      ...base };
  }
  return { ok: true, ...base };
}

module.exports = { locateStatements, buildHeads, HAIKU_MODEL, HEAD_CHARS };
