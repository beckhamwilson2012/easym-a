// server/services/extractorAgent.js
// Phase 3 of the document pipeline: the EXTRACTOR agent (Sonnet, ONE call per locator-tagged page).
// Only tagged pages are ever sent. The model's job is pure TRANSCRIPTION — read each printed cell and
// map it to its period column. It does NOT compute, sum, infer, or scale. ALL numeric work happens
// here in JS:
//   • parentheses -> negative, commas/"$"/whitespace stripped   (parseNumber)
//   • the reporting scale (millions/thousands) is applied ONCE, in JS, from the locator's document fact
//     — and NOT to per-share amounts ("(In millions, except per share amounts)").
//
// Parsing notes carried over from Phase 1:
//   • the "$" glyph FLOATS (leads a column or trails the prior number) — the model is told to split on
//     runs of 2+ spaces and treat "$" as a free token, never fixed character offsets.
//   • never ask the model for a computed total (e.g. total debt) — transcribe printed lines only; JS sums.

const https = require('https');

const SONNET_MODEL = 'claude-sonnet-4-6';
const PRICE = { input: 3.0, output: 15.0 };            // Sonnet 4.6 $/1M (in / out)
const SCALE_FACTOR = { millions: 1e6, thousands: 1e3, billions: 1e9 };

// Parse a printed cell EXACTLY (JS only — the model never does this).
// "(427)"->-427, "55,519"->55519, "$ 74,989"->74989, "(0.64)"->-0.64, "—"/"-"->null.
function parseNumber(raw) {
  if (raw == null) return { value: null };
  let s = String(raw).trim();
  if (s === '' || /^[—–-]$|^n\/?a$/i.test(s)) return { value: null };
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()$,\s]/g, '').replace(/^-/, '');
  if (s === '' || Number.isNaN(Number(s))) return { value: null, unparsed: String(raw) };
  const n = Number(s);
  return { value: negative ? -n : n };
}

const SYSTEM = `You are a financial-statement TRANSCRIBER. You are given the text of ONE page of an SEC filing (a single financial statement) rendered with "pdftotext -layout", so columns are separated by runs of 2+ spaces. Your ONLY job is to transcribe each printed numeric line item exactly, mapping each number to its period column.

You MUST NOT compute, sum, average, derive a margin, or infer anything. You MUST NOT invent a value that is not printed, and you MUST NOT carry a value from one column into another.

How to read the page:
- Find the PERIOD column headers (e.g. year headers like "2013  2014  2015", often under "Year Ended December 31,"). Record them left-to-right in periodColumns.
- Column alignment: split each row on runs of 2+ spaces. The "$" glyph FLOATS — it may lead a column or trail the previous number; treat "$" as a free token and align each number to its period column by POSITION, never by fixed character offset.
- For EACH line-item row, output ONE object PER period column that actually has a printed number:
  - verbatimLabel: this row's OWN label text, EXACTLY as printed, and NOTHING else. Do NOT prepend a parent header, do NOT enrich or disambiguate it. If two rows print the same label ("Continuing operations"), repeat it verbatim — that is correct. Provenance means this figure traces to THIS printed text.
  - parentLabel: if this row is a sub-item indented under a section header (e.g. "Basic net income (loss) per share of Class A and B common stock:"), the EXACT text of that header. If there is no parent header, use "".
  - periodLabel: the exact period header of that column (e.g. "2013").
  - rawValue: the cell EXACTLY as printed — keep commas, keep parentheses, keep any "$". Do NOT sign-flip, strip, round, or scale it.
  - page: the page number you were given.
  - isPerShare: true if this line is a PER-SHARE amount (it sits under a "per share" heading or the label says per share). This is a classification flag only — do not change the number. (Downstream code cross-checks it and uses the document's scale fact to decide scaling.)
- If a column has no printed value for a row, emit NOTHING for that column.
- Transcribe only numbers that are PRINTED. A printed subtotal/total line is fine to transcribe (you are reading it). NEVER produce a total you had to add up yourself.
- Do NOT apply any reporting scale (millions/thousands). Transcribe the raw printed digits.

Return everything via the report_line_items tool. No prose.`;

const TOOL = {
  name: 'report_line_items',
  description: 'Transcribe every printed line item on the page, one object per period column.',
  input_schema: {
    type: 'object',
    properties: {
      periodColumns: { type: 'array', items: { type: 'string' }, description: 'Period headers left-to-right, e.g. ["2013","2014","2015"].' },
      lineItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            verbatimLabel: { type: 'string', description: 'This row\'s own printed label ONLY — never enriched with a parent header.' },
            parentLabel:   { type: 'string', description: 'Exact parent/section-header text if this row is a sub-item, else "".' },
            periodLabel:   { type: 'string' },
            rawValue:      { type: 'string', description: 'Cell exactly as printed: keep commas, parentheses, and any "$".' },
            page:          { type: 'integer' },
            isPerShare:    { type: 'boolean' },
          },
          required: ['verbatimLabel', 'parentLabel', 'periodLabel', 'rawValue', 'page', 'isPerShare'],
        },
      },
    },
    required: ['periodColumns', 'lineItems'],
  },
};

// Raw HTTPS POST to the Messages API (matches server.js's no-SDK style). Shared by full-page and
// single-field transcription.
function postMessages(payload) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY || '';
    if (!key) return reject(new Error('ANTHROPIC_API_KEY not set'));
    const body = JSON.stringify(payload);
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

function callSonnet(pageText, pageNumber) {
  return postMessages({
    model: SONNET_MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM,
    tools: [TOOL], tool_choice: { type: 'tool', name: 'report_line_items' },
    messages: [{ role: 'user', content: `Page ${pageNumber} of the filing (pdftotext -layout). Transcribe every printed line item, one object per period column.\n\n<<<PAGE ${pageNumber}>>>\n${pageText}` }],
  });
}

// TARGETED re-extraction of ONE cell — the validator's single retry on a failed check. Same page,
// same rules, but the model is asked for exactly one line item/period. Returns {value, rawValue} or null.
async function extractField(pageText, pageNumber, field, facts) {
  const { verbatimLabel, parentLabel, periodLabel } = field || {};
  const q = `From the page below, transcribe ONLY the single cell for the line item "${verbatimLabel}"` +
    `${parentLabel ? ` (under the header "${parentLabel}")` : ''} in the period "${periodLabel}". ` +
    `Emit exactly one line item via the tool; do not transcribe any other row.\n\n<<<PAGE ${pageNumber}>>>\n${pageText}`;
  const resp = await postMessages({
    model: SONNET_MODEL, max_tokens: 800, temperature: 0, system: SYSTEM,
    tools: [TOOL], tool_choice: { type: 'tool', name: 'report_line_items' },
    messages: [{ role: 'user', content: q }],
  });
  const block = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'report_line_items');
  const lis = (block && block.input && block.input.lineItems) || [];
  const li = lis.find(x => x.periodLabel === periodLabel) || lis[0];
  if (!li) return null;
  const { value } = parseNumber(li.rawValue);
  return { value, rawValue: li.rawValue };
}

// Extract one tagged page. `facts` is the locator's document fact: { scale, exceptPerShare }.
// The scale DECISION is document-fact-driven (exceptPerShare + a deterministic per-share label test),
// NOT the model's per-row flag — that flag is retained only as a cross-check for the validator.
async function extractPage(pageText, pageNumber, facts) {
  const scale = (facts && typeof facts === 'object') ? facts.scale : facts;
  const exceptPerShare = (facts && typeof facts === 'object') ? facts.exceptPerShare === true : false;
  const factor = SCALE_FACTOR[scale];
  if (factor == null) throw new Error(`Extractor: unusable scale "${scale}" — the locator must supply millions/thousands/billions`);

  const resp = await callSonnet(pageText, pageNumber);
  const block = (resp.content || []).find(b => b.type === 'tool_use' && b.name === 'report_line_items');
  if (!block) throw new Error('Extractor: model did not return the report_line_items tool call');
  const out = block.input || {};

  const usage = resp.usage || {};
  const costUsd = (usage.input_tokens || 0) / 1e6 * PRICE.input + (usage.output_tokens || 0) / 1e6 * PRICE.output;

  const items = [], dropped = [];
  for (const li of (out.lineItems || [])) {
    // "Accept no value without a page number": stamp the authoritative page; drop any mis-attributed item.
    if (li.page !== pageNumber) { dropped.push({ ...li, why: 'page-mismatch' }); continue; }
    const { value, unparsed } = parseNumber(li.rawValue);
    const verbatimLabel = String(li.verbatimLabel || '').trim();
    const parentLabel = String(li.parentLabel || '').trim();
    // Deterministic per-share test from the printed labels (parent + own). This — gated by the
    // document's exceptPerShare fact — drives scaling. The model's flag is a separate cross-check.
    const labelPerShare = /per\s*share/i.test((parentLabel ? parentLabel + ' ' : '') + verbatimLabel);
    const modelPerShareFlag = li.isPerShare === true;
    const scaleApplied = !(exceptPerShare && labelPerShare) && value != null;
    items.push({
      verbatimLabel,                                         // strictly verbatim (Correction 2)
      parentLabel,                                           // parent header kept separate (Correction 2)
      periodLabel: String(li.periodLabel || '').trim(),
      page: pageNumber,
      rawValue: li.rawValue,
      value,                                                 // parsed, pre-scale, parens->negative (JS)
      labelPerShare,                                         // deterministic (document-fact path)
      modelPerShareFlag,                                     // the model's flag (cross-check only)
      scaleApplied,
      scaledValue: value == null ? null : (scaleApplied ? value * factor : value),
      status: 'ok',
      ...(unparsed ? { unparsed } : {}),
    });
  }

  return {
    ok: true,
    page: pageNumber,
    scale, exceptPerShare, factor,
    periodColumns: Array.isArray(out.periodColumns) ? out.periodColumns : [],
    items, dropped,
    model: SONNET_MODEL,
    usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 },
    costUsd,
  };
}

module.exports = { extractPage, extractField, parseNumber, SONNET_MODEL, SCALE_FACTOR };
