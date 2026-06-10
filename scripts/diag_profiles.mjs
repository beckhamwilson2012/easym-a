// DIAGNOSTIC (Phase 1): §3 Company Profiles renders blank for known large-caps. Prove the root cause:
// the lookup KEY is correct (ticker, case-folded) but COMPANY_PROFILES only has CRM + TEAM, so every
// other large-cap falls to PROFILE_NA (all "—") with no fetch/fallback → fully blank profile.
import { getCompanyProfile, COMPANY_PROFILES } from '../src/lib/companyProfiles.js';

console.log('Curated tickers in COMPANY_PROFILES:', Object.keys(COMPANY_PROFILES).join(', '));
console.log('');
const KNOWN_LARGE_CAPS = ['CRM', 'TEAM', 'MSFT', 'ADBE', 'NOW', 'GOOGL', 'HUBS', 'ORCL', 'SAP', 'INTU'];
for (const t of KNOWN_LARGE_CAPS) {
  const p = getCompanyProfile(t, t);               // lookup key = ticker (what the component passes)
  const blankCount = ['founded', 'ceo', 'hq', 'employees', 'customers', 'gtm', 'products'].filter(k => !p[k] || p[k] === '—').length;
  console.log(`${t.padEnd(6)} curated=${String(p.curated).padEnd(5)} ceo="${p.ceo}" hq="${p.hq}"  -> ${blankCount}/7 attribute fields blank ${blankCount >= 6 ? '  <-- FULLY BLANK (bug)' : ''}`);
}
console.log('');
console.log('ROOT CAUSE: not a key mismatch (key=ticker resolves) — COMPANY_PROFILES is missing entries for');
console.log('every large-cap except CRM/TEAM, and getCompanyProfile has no fetch/fallback, so known');
console.log('large-caps (MSFT, ADBE, NOW, ...) render fully blank "—".');
