// server/services/uploadExtract.js
// Phase 1 of the document-upload pipeline: turn an uploaded PDF or XLSX into per-page text.
// This module's ENTIRE job is text extraction — it calls NO model and parses NO financials.
//
//   PDF   →  `pdftotext -layout` (poppler) for the digital text layer. Any page whose text layer
//            yields fewer than OCR_MIN_CHARS characters is rasterized (`pdftoppm -png -r 300`) and
//            OCR'd (`tesseract … -l eng`). Result: text indexed by page number.
//   XLSX  →  SheetJS → one normalized tab-separated text grid per worksheet (each sheet = a "page").
//
// Binaries resolve from a user-local, no-sudo prefix (default ~/.easyma-ocr, a conda-forge install of
// poppler + tesseract) or, if that is absent, from PATH (e.g. a Homebrew `brew install poppler
// tesseract`). Override individually with env: EASYMA_OCR_PREFIX / PDFTOTEXT_BIN / PDFTOPPM_BIN /
// TESSERACT_BIN. Tunables: UPLOAD_OCR_MIN_CHARS, UPLOAD_OCR_DPI, UPLOAD_PROC_TIMEOUT_MS.

const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const XLSX = require('xlsx');

const OCR_MIN_CHARS = Number(process.env.UPLOAD_OCR_MIN_CHARS || 100);      // page under this → OCR
const OCR_DPI       = Number(process.env.UPLOAD_OCR_DPI || 300);            // rasterization DPI
const PROC_TIMEOUT  = Number(process.env.UPLOAD_PROC_TIMEOUT_MS || 120000); // per child process

// ── binary resolution ─────────────────────────────────────────────────────────
const PREFIX = process.env.EASYMA_OCR_PREFIX || path.join(os.homedir(), '.easyma-ocr');
function resolveBin(envVar, name) {
  if (process.env[envVar]) return process.env[envVar];
  const local = path.join(PREFIX, 'bin', name);
  try { fs.accessSync(local, fs.constants.X_OK); return local; } catch { /* not local */ }
  return name; // fall back to PATH (system / Homebrew install)
}
const PDFTOTEXT = resolveBin('PDFTOTEXT_BIN', 'pdftotext');
const PDFTOPPM  = resolveBin('PDFTOPPM_BIN',  'pdftoppm');
const TESSERACT = resolveBin('TESSERACT_BIN', 'tesseract');
const USING_PREFIX = PDFTOTEXT.startsWith(PREFIX);

// Spawn env: when using the local prefix, expose its libs + tessdata (conda binaries carry an rpath,
// so this is belt-and-suspenders, but it makes an odd PATH/DYLD environment harmless).
function childEnv() {
  const env = { ...process.env };
  if (USING_PREFIX) {
    env.PATH = [path.join(PREFIX, 'bin'), env.PATH].filter(Boolean).join(':');
    env.DYLD_FALLBACK_LIBRARY_PATH = [path.join(PREFIX, 'lib'), env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':');
    if (!env.TESSDATA_PREFIX) env.TESSDATA_PREFIX = path.join(PREFIX, 'share', 'tessdata');
  }
  return env;
}

// Spawn a binary and collect stdout. Rejects on spawn error, nonzero exit, or timeout.
// No shell is used — args are passed as an array, so a hostile filename cannot inject a command.
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnv() });
    const out = [], err = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, PROC_TIMEOUT);
    child.on('error', e => {
      clearTimeout(timer);
      reject(new Error(`${path.basename(bin)} could not run: ${e.message} — is poppler/tesseract installed? (EASYMA_OCR_PREFIX=${PREFIX})`));
    });
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${path.basename(bin)} timed out after ${PROC_TIMEOUT}ms`));
      if (code !== 0) return reject(new Error(`${path.basename(bin)} exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 300)}`));
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}

// ── PDF ─────────────────────────────────────────────────────────────────────
// pdftotext -layout emits a form-feed (\f) at the end of EVERY page, so N pages → N text chunks
// plus one trailing empty chunk (the \f after the final page), which we drop. A page whose text
// layer is sparse (< OCR_MIN_CHARS non-whitespace chars) is a likely scan → route it to OCR.
async function extractPdf(filePath) {
  const raw = await run(PDFTOTEXT, ['-layout', '-enc', 'UTF-8', filePath, '-']);
  let chunks = raw.split('\f');
  if (chunks.length > 1 && chunks[chunks.length - 1] === '') chunks.pop(); // trailing \f after last page
  if (chunks.length === 0) chunks = [''];

  const pages = [];
  for (let i = 0; i < chunks.length; i++) {
    const pageNo = i + 1;
    const layoutText = chunks[i];
    if (layoutText.replace(/\s/g, '').length >= OCR_MIN_CHARS) {
      pages.push({ page: pageNo, source: 'pdftotext', chars: layoutText.length, text: layoutText });
      continue;
    }
    // sparse page → OCR. If OCR itself fails, keep the (thin) text layer and record why.
    try {
      const ocrText = await ocrPage(filePath, pageNo);
      pages.push({ page: pageNo, source: 'ocr', chars: ocrText.length, text: ocrText, textLayerChars: layoutText.replace(/\s/g, '').length });
    } catch (e) {
      pages.push({ page: pageNo, source: 'pdftotext', chars: layoutText.length, text: layoutText, ocrError: e.message.slice(0, 200) });
    }
  }
  return { kind: 'pdf', pageCount: pages.length, pages };
}

// Rasterize ONE page to PNG and OCR it. All scratch images are written to a private temp dir that
// is always removed, even on error.
async function ocrPage(filePath, pageNo) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'easyma-ocr-'));
  try {
    const prefix = path.join(scratch, 'page');
    // pdftoppm -png -r DPI -f N -l N <pdf> <prefix>  →  <prefix>-<N>.png (single image, since -f=-l=N)
    await run(PDFTOPPM, ['-png', '-r', String(OCR_DPI), '-f', String(pageNo), '-l', String(pageNo), filePath, prefix]);
    const png = fs.readdirSync(scratch).filter(f => f.toLowerCase().endsWith('.png'))[0];
    if (!png) throw new Error('pdftoppm produced no image');
    return await run(TESSERACT, [path.join(scratch, png), 'stdout', '-l', 'eng']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// ── XLSX ──────────────────────────────────────────────────────────────────────
// One normalized text grid per worksheet: each cell collapsed to single-spaced text, cells joined by
// TAB, rows joined by newline, trailing empty cells trimmed. Read-only; formula & HTML parsing are
// disabled (xlsx 0.18.5 hardening — we never evaluate a formula, and the temp file is deleted after).
function extractXlsx(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellText: true, sheetStubs: false });
  const pages = [];
  (wb.SheetNames || []).forEach((name, idx) => {
    const ws = wb.Sheets[name];
    const aoa = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) : [];
    const lines = aoa.map(row =>
      (Array.isArray(row) ? row : [])
        .map(c => (c == null ? '' : String(c)).replace(/\s+/g, ' ').trim())
        .join('\t')
        .replace(/\t+$/, '')
    );
    const text = lines.join('\n');
    pages.push({ page: idx + 1, sheet: name, source: 'sheetjs', rows: aoa.length, chars: text.length, text });
  });
  return { kind: 'xlsx', pageCount: pages.length, pages };
}

module.exports = {
  extractPdf,
  extractXlsx,
  OCR_MIN_CHARS,
  binaries: { PDFTOTEXT, PDFTOPPM, TESSERACT, PREFIX, usingPrefix: USING_PREFIX },
};
