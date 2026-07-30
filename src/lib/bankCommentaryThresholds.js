/**
 * Qualitative-band helpers for bank M&A commentary.
 * Used in SectionStandalonePL and any other section that needs
 * plain-English labels for efficiency ratio / CET1 values.
 */

export function efficiencyRatioLabel(pct) {
  if (pct == null) return null;
  if (pct < 55)   return 'best-in-class';
  if (pct < 65)   return 'in line with peers';
  return 'above peer median';
}

export function cet1Label(pct) {
  if (pct == null) return null;
  if (pct > 13)  return 'well above well-capitalized threshold';
  if (pct > 11)  return 'comfortably above well-capitalized threshold';
  if (pct > 10)  return 'modestly above well-capitalized threshold';
  return 'BELOW well-capitalized threshold — capital action required';
}
