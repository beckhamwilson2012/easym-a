import { fmtCalendarDate } from './easternTime';

// The period behind the revenue figure on a company card, read from the /quote payload. Today's EDGAR path always
// carries the annual figure with its period end. "LTM to" needs the LTM revenue to be the very figure shown, with no
// annual period end behind it. Anything else is unknown, never a guess. The FMP fallback carries its period on the
// revenue trace-back, since SAP and Toyota have no current year in the SEC data this app reads.
export function revenuePeriodLabel(data) {
  const fy = fmtCalendarDate(data?.fiscalYearEnd ?? data?.revenueTrace?.fiscalYearEnd);
  if (fy) return `FY ended ${fy}`;
  const ltm = data?.ltm;
  const ltmEnd = fmtCalendarDate(ltm?.asOf);
  if (ltm?.trusted && ltmEnd && data?.revenue != null && ltm.revenue === data.revenue) return `LTM to ${ltmEnd}`;
  return 'period unknown';
}
