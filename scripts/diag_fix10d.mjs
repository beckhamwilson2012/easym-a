// DIAGNOSTIC (Fix 10d): prove the §4/§5 D&A line flips sign for negative-EBITDA companies. estDA =
// ebitda × 0.15 goes NEGATIVE when EBITDA ≤ 0, and the P&L renders fmtMoneyAccounting(-estDA), so a
// subtraction (parens) becomes a positive addition — inconsistent with Operating Expenses, which is
// always shown in parens. Net debt = debt - cash is checked for convention consistency too.
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

// fmtMoneyAccounting: negative → "($X)", non-negative → "$X" (parens denote a subtraction).
const acct = (m) => m < 0 ? `($${Math.abs(Math.round(m))}M)` : `$${Math.round(m)}M`;

for (const t of ['CRM', 'TEAM']) {
  const q = await g('/quote?symbol=' + t);
  const ebitda = q.ebitda || 0, ni = q.netIncome || 0, rev = q.revenue || 0, debt = q.debt || 0, cash = q.cash || 0;
  // current estDA (SectionStandalonePL.js l.85)
  const estDA_cur = ebitda > 0 && ni > 0 && ni < ebitda ? (ebitda - ni) * 0.5 : ebitda * 0.15;
  // proposed: revenue-based proxy when EBITDA ≤ 0 so D&A is always a positive expense
  const estDA_fix = ebitda > 0 && ni > 0 && ni < ebitda ? (ebitda - ni) * 0.5 : (ebitda > 0 ? ebitda * 0.15 : rev * 0.04);
  const netDebt = debt - cash;
  console.log(`${t}: EBITDA=${acct(ebitda)}`);
  console.log(`   D&A row CURRENT: ${acct(-estDA_cur)}  ${estDA_cur < 0 ? '<-- SIGN FLIP (shows as +addition, not a subtraction)' : '(ok, subtraction)'}`);
  console.log(`   D&A row FIXED:   ${acct(-estDA_fix)}  (always a subtraction)`);
  console.log(`   Net Debt/(Cash): ${netDebt < 0 ? acct(netDebt) + ' = net CASH' : acct(netDebt) + ' = net DEBT'}  (convention: debt - cash)`);
  console.log('');
}
