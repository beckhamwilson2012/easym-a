// DIAGNOSTIC (Fix 2): prove the §13 EV/EBITDA price series is degenerate for a negative-EBITDA target.
import { generatePriceSeries } from '../src/components/deck/shared/deckTokens.js';
const team = { ebitda: -38, shares: 262, cash: 2513, debt: 988, eps: -0.98, revenue: 5215 };
const deal = { offerPrice: 127.26 };
console.log('TEAM ebitda =', team.ebitda, '(<=0). Current §13 EV/EBITDA generatePriceSeries():');
for (const r of generatePriceSeries(team, deal)) {
  console.log(`  ${r.multiple}x EV/EBITDA → implied EV=$${r.ev}M  price/sh=$${r.price.toFixed(2)}  vs offer=${r.diffPct!=null?(r.diffPct>0?'+':'')+r.diffPct.toFixed(1)+'%':'—'}`);
}
console.log('\nProposed EV/Revenue fallback (valid for unprofitable targets):');
for (const m of [2,3,4,5,6]) {
  const ev = team.revenue * m, price = (ev - team.debt + team.cash) / team.shares;
  console.log(`  ${m}x EV/Rev → implied EV=$${ev}M  price/sh=$${price.toFixed(2)}  vs offer=${((deal.offerPrice-price)/price*100>0?'+':'')+((deal.offerPrice-price)/price*100).toFixed(1)}%`);
}
