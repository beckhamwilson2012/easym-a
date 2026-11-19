// The GAAP one-time-item flag (Fix 22 Task 3). UBER/LYFT read "Accretive (+74.4%)" on GAAP because Lyft's LTM net income holds a
// $2,854M income tax benefit, against −0.4% on Non-GAAP. This rule only says so: no net income, EPS or verdict is adjusted.
//
//   • an item (impairment, gain or loss on a sale, disposal or investments) above 25% of |net income| for the same period;
//   • income tax that is a benefit (filed negative) above 25% of |pre-tax income| for the same period.
//
// The figures are server/services/unusualItems.js, on the company's own basis (LTM or fiscal year). An absent figure is no
// test: it never counts as 0 and never raises a flag.
export const ONE_TIME_SHARE = 0.25;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => `$${Math.round(Math.abs(v)).toLocaleString('en-US')}M`;
const itemName = (it) => (it.kind === 'gainLoss' ? `${it.value < 0 ? 'loss' : 'gain'} on ${it.label}` : it.label);

export function oneTimeItems(u) {
  if (!u) return [];
  const out = [];
  if (isNum(u.incomeTax) && isNum(u.pretaxIncome) && u.incomeTax < 0 && Math.abs(u.incomeTax) > ONE_TIME_SHARE * Math.abs(u.pretaxIncome)) {
    out.push({ key: 'incomeTaxBenefit', name: 'income tax benefit', value: u.incomeTax, concept: u.taxConcept ?? null });
  }
  if (isNum(u.netIncome)) {
    for (const it of u.items || []) {
      if (!isNum(it.value) || it.value === 0 || Math.abs(it.value) <= ONE_TIME_SHARE * Math.abs(u.netIncome)) continue;
      // An aggregate tag equal to an item already listed is the same charge, said once.
      if (out.some((x) => Math.abs(x.value) === Math.abs(it.value))) continue;
      out.push({ key: it.key, name: itemName(it), value: it.value, concept: it.concept ?? null });
    }
  }
  return out;
}

export const oneTimeText = (company, item, period) =>
  `${company} GAAP net income includes a ${money(item.value)} ${item.name}${period ? ` (${period})` : ''}; the GAAP result reflects it. See Non-GAAP.`;

// Both companies' flags for the deal, each with its sentence. companies = [{ name, unusual, period }].
export function oneTimeNotes(companies) {
  return companies.flatMap((c) => oneTimeItems(c.unusual).map((item) => ({ ...item, company: c.name, period: c.period, text: oneTimeText(c.name, item, c.period) })));
}
