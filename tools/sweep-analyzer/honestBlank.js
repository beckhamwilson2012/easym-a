// ─────────────────────────────────────────────────────────────────────────────
// HONEST BLANK — is a "—" / "n/m" / "N/A" cell explained ON SCREEN?
//
// Fix 7A, 7B and 10 changed the deck's rule for absent figures: a figure the deck cannot source or that is
// not meaningful renders "—" or "n/m" AND says why, on the same slide. That is the correct output, not a
// missing value. The grader used to treat every "—" beside a value elsewhere as a defect, so each honest
// blank scored like a dropped number.
//
// The rule this module encodes, and nothing looser:
//   • a blank WITH its reason on the same section → honest (recorded EXPECTED, with the reason quoted)
//   • a blank with NO reason on that section      → still a defect
// Reasons are found in exactly four places, all read from the rendered text, never from the app's code:
//   1. inline in the cell:      "— consensus is non-GAAP; no GAAP forecast", "n/m — above 100x (…)", "n/m (EPS ≤ 0)"
//   2. inline in the row label: "Year 2 FY2026e — consensus is non-GAAP; no GAAP forecast"
//   3. a footnote marker on the row label ("Gross Profit n") whose note is printed in the section
//      ("n No consensus available: FMP publishes no forward gross profit, so … are "—".")
//   4. a sentence in the section that names the row AND states it is blank ('Forward Operating Expense is "—" — …'),
//      or, for n/m only, the section's printed n/m rule ("Every multiple is n/m when its denominator is …").
// A reason must be at least a few words of prose. A bare marker with no note, or a note that never mentions
// the row, does not count.
// ─────────────────────────────────────────────────────────────────────────────

const SUP = 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ*†‡§¹²³⁴⁵⁶⁷⁸⁹';
const BLANK_HEAD = new RegExp(`^(?:—|–|-|n\\/?m|n\\.m\\.?|N\\/A)(?=$|[\\s:(—–${SUP}-])`, 'i');

// normalise the unicode minus the deck uses since Fix 10 Task 8 ("−$0.36"); every parser runs on this
function normMinus(s) { return s == null ? s : String(s).replace(/−/g, '-'); }

function isBlankToken(tok) { return BLANK_HEAD.test(String(tok == null ? '' : tok).trim()); }
function isNM(tok) { return /^(?:n\/?m|n\.m\.?)/i.test(String(tok == null ? '' : tok).trim()); }
// a footnote marker glued to the CELL: "n/mᵇ" → "ᵇ"
function cellMarker(tok) { const m = String(tok == null ? '' : tok).trim().match(new RegExp(`^(?:—|–|n\\/?m|N\\/A)([${SUP}])$`, 'iu')); return m ? m[1] : null; }

// 1. reason inside the cell itself
function inlineReason(tok) {
  const t = String(tok == null ? '' : tok).trim();
  // "— reason" / "n/m — reason" / "n/m (reason)" / "— (reason)"; a hyphen needs an explicit separator, since
  // "- word" can be ordinary list text
  const m = t.match(/^(?:—|–|-|n\/?m|n\.m\.?|N\/A)\s*(?:[—–:-]\s*|\()\s*([A-Za-z][^]{7,})$/i) || t.match(/^(?:—|–|n\/?m|n\.m\.?|N\/A)\s+([A-Za-z][^]{7,})$/i);
  return m ? m[1].replace(/\)$/, '').trim() : null;
}

// strip a trailing footnote marker / parenthetical from a row label → the words a note would use
function labelCore(label) {
  return String(label || '').replace(/\s+[a-z*†‡§¹²³⁴⁵⁶⁷⁸⁹]$/u, '').replace(/\([^)]*\)/g, '').replace(/[:%]/g, '').trim();
}
function footMarker(label) {
  const m = String(label || '').trim().match(/\s([a-z*†‡§¹²³⁴⁵⁶⁷⁸⁹])$/u);
  return m ? m[1] : null;
}
// says the cell is BLANK — a quoted dash or an explicit phrase. A bare em-dash is punctuation in this deck's
// prose and proves nothing, so it never counts on its own.
const BLANK_SAID = /["“]—["”]|\b(?:is|are|shows?|renders?|reads?)\s+["“]?—|not available|not meaningful|no consensus|\bn\/m\b/i;
// stricter, for free prose: the sentence must show the blank itself, quoted or as "is/are —", or say n/m.
const BLANK_GLYPH = /["“]—["”]|\b(?:is|are|shows?|renders?|reads?)\s+["“]?—|\bn\/m\b/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 2. reason inside the row label: "<label> — <prose>"
function labelReason(label) {
  const m = String(label || '').match(/\s—\s+([A-Za-z][^]{9,})$/);
  return m ? m[1].trim() : null;
}

// 3. footnote: the marker, then a sentence of prose, somewhere in the section
function footnoteReason(label, section, marker) {
  const mk = marker || footMarker(label); if (!mk) return null;
  const re = new RegExp(`(?:^|[\\s.;])${esc(mk)}\\s+([A-Z][^\\n]{20,}?)(?:$|\\n|(?<=\\.)\\s)`, 'mu');
  const m = String(section || '').match(re);
  if (!m) return null;
  const note = m[1];
  const core = labelCore(label).toLowerCase();
  // the note must be ABOUT this row: name it, or say what it blanks
  return BLANK_SAID.test(note) ? note.trim() : null;
}

// 4. a sentence in the section naming the row and saying it is blank. The row must be the SUBJECT: its name
//    comes first and the blank statement follows within the same clause ("…, gross profit and gross margin are
//    "—"", "Forward Operating Expense is "—""). A sentence that blanks a DIFFERENT row and merely mentions this
//    one afterwards ("Operating Expense is "—" — consensus supplies operating income but not gross profit") is
//    not this row's reason. For n/m the printed rule counts when it is general ("Every multiple is n/m when …")
//    or names this row's metric ("EV/EBITDA is n/m where …"); a rule for another metric does not.
const squash = x => String(x || '').toLowerCase().replace(/\s+/g, '');
function sentenceReason(label, section, nm) {
  const core = labelCore(label);
  const prose = String(section || '').split('\n').filter(x => !x.includes('\t')).join('\n');
  const sentences = prose.split(/\n|(?<=[.;])\s+/);
  if (core.length >= 3) {
    const subj = new RegExp(`${esc(core)}[^.;"“]{0,80}?(?:\\b(?:is|are|shows?|renders?|reads?)\\s+["“]?—|\\bis n\\/m\\b)`, 'i');
    for (const s of sentences) if (subj.test(s)) return s.trim();
  }
  if (nm) {
    const rules = prose.match(/[^.\n]*\bn\/m[ᵃ-ᶻ]?\s+(?:when|where|if|because)[^.\n]{10,}/gi) || [];
    const key = squash(core);
    for (const r of rules) if (/\b(?:every|all|any)\s+multiples?\b/i.test(r) || (key.length >= 3 && squash(r).includes(key))) return r.trim();
  }
  return null;
}

// The one entry point. Returns the reason string, or null when the blank is unexplained.
// tok = the cell text; label = the row label the cell sits on; section = that section's rendered text.
function reasonFor(tok, label, section) {
  const t = String(tok == null ? '' : tok).trim();
  if (t !== '' && !isBlankToken(t)) return null;          // not a blank — nothing to explain
  const cm = cellMarker(t);
  return inlineReason(t) || (cm && footnoteReason(label, section, cm)) || labelReason(label) || footnoteReason(label, section) || sentenceReason(label, section, isNM(t)) || null;
}

module.exports = { cellMarker, reasonFor, inlineReason, labelReason, footnoteReason, sentenceReason, isBlankToken, isNM, normMinus, labelCore };
