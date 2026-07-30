// DIAGNOSTIC. Renders the deck for AT acquires TT, then verifies the non-GAAP DISPLAY layer:
//   §4 Standalone P&L — Acquirer, §5 Standalone P&L — Target, §6 Comparative Financial Profile.
// Captures each slide's profitability rows + basis labels + basis footnote, and the Dashboard's
// acquirer standalone EPS + accretion (to prove the accretion math still runs on GAAP, untouched).
// Usage: node scripts/diag_nongaap_display.mjs <AT> <AN> <TT> <TN>
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT=process.argv[2], AN=process.argv[3], TT=process.argv[4], TN=process.argv[5];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const bodyText = () => p.evaluate(()=>document.body.innerText);
const wait = async (re,t=20000)=>{const s=Date.now();while(Date.now()-s<t){if(re.test(await bodyText()))return true;await sleep(300);}return false;};
const load = async (i,tk,nm)=>{const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:45});await sleep(1200);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true;}return false;});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1200);};
const clk = async re=>{await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click();},re.source);await sleep(1100);};
const setOffer = async ()=>{const m=(await bodyText()).match(/Suggested:\s*\$?([\d.]+)\/share/i);if(m){await p.evaluate(v=>{const el=document.querySelector('input[name="offerPricePerShare"]');if(!el)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();},m[1]);await sleep(400);}};
// Click a deck tab by exact label, then return the *visible* active-section wrapper's innerText.
const clickTab = async (label)=>{
  await p.evaluate(lbl=>{const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && e.textContent.trim()===lbl);if(el)el.click();}, label);
  await sleep(1400); // allow async fetches (revenue history, etc.) to settle
};
// Visible section = the wrapper with max-width 850px (dashboard uses 1200). Scope to it so we never
// read the offscreen PDF-capture clones (which render every section at left:-10000).
const sectionText = (maxw='850px')=> p.evaluate(mw=>{
  const wrap=[...document.querySelectorAll('div')].find(d=>d.style.maxWidth===mw);
  return wrap ? wrap.innerText : '(section wrapper not found)';
}, maxw);
const pick = (txt,re)=>{const m=txt.match(re);return m?m[0].replace(/\s+/g,' ').trim():'(absent)';};
// Structured table rows from the VISIBLE section wrapper: PLRow = 2 child spans [label,value];
// MetricRow = 3 child divs [label, acqVal, tgtVal]. Returns labels matching the profitability set.
const tableRows = (maxw='850px')=> p.evaluate(mw=>{
  const wrap=[...document.querySelectorAll('div')].find(d=>d.style.maxWidth===mw);
  if(!wrap) return [];
  const out=[];
  wrap.querySelectorAll('div').forEach(d=>{
    const kids=[...d.children];
    if(kids.length===2 && kids.every(k=>k.tagName==='SPAN'))
      out.push([kids[0].innerText.trim(), kids[1].innerText.trim()]);
    else if(kids.length===3 && kids.every(k=>k.tagName==='DIV') && kids[0].innerText.trim() && /[\d$%]/.test(kids[1].innerText))
      out.push([kids[0].innerText.trim(), kids[1].innerText.trim(), kids[2].innerText.trim()]);
  });
  return out;
}, maxw);
const KEYS=/^(Revenue|Gross Profit|Gross Margin|Operating Expenses|Operating Income|Operating Margin|EBITDA|EBITDA Margin|D&A|Net Income|Net Margin|Diluted EPS|EPS)/i;
const showRows = (rows)=> rows.filter(r=>KEYS.test(r[0])).forEach(r=>console.log('    '+r.join('   |   ')));
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2000);

  console.log(`### ${AN}(${AT}) acquires ${TN}(${TT}) — NON-GAAP DISPLAY LAYER VERIFICATION ###\n`);

  // /api/nongaap does a live EDGAR fetch + LLM extract per company (cold ~15-25s each, parallel; warm
  // ~1ms). Until they resolve the deck shows the honest GAAP-labeled fallback. Poll §4 every 250ms and
  // report how long the GAAP→non-GAAP "pop" takes — near-instant on a warm cache, ~20s cold.
  await clickTab('Standalone P&L — Acquirer');
  const t0=Date.now(); let resolved=false, ms=null;
  for (let i=0;i<360;i++){ const txt=await sectionText('850px'); if(/Operating Income \(Non-GAAP\)/.test(txt)){resolved=true;ms=Date.now()-t0;break;} await sleep(250); }
  console.log(`(non-GAAP resolved in browser: ${resolved}${resolved?` — ${(ms/1000).toFixed(1)}s after reaching §4`:' — still GAAP fallback after 90s'})\n`);

  // Dashboard — capture acquirer standalone EPS + accretion (proves the GAAP math is UNCHANGED).
  await clickTab('Dashboard');
  const dashFull = await bodyText();
  console.log('— DASHBOARD (accretion runs on GAAP; acquirer standalone EPS must be GAAP, NOT non-GAAP) —');
  const epsLines = dashFull.split('\n').filter(l=>/EPS|accretive|dilutive|\$\d+\.\d{2}/i.test(l)).slice(0,10);
  epsLines.forEach(l=>console.log('    ', l.replace(/\s+/g,' ').trim()));
  console.log('    ACCRETION:', pick(dashFull, /[+\-]?\d+\.\d+%\s*(accretive|dilutive)/i));

  for (const [tab, who] of [['Standalone P&L — Acquirer','§4 ACQUIRER '+AT],['Standalone P&L — Target','§5 TARGET '+TT]]) {
    await clickTab(tab);
    console.log(`\n— ${who} (${tab}) —  [label | value]`);
    showRows(await tableRows('850px'));
    console.log('    BASIS NOTE:', pick(await sectionText('850px'), /Basis of presentation:[\s\S]{0,300}/i));
  }

  await clickTab('Financial Profile');
  console.log('\n— §6 COMPARATIVE FINANCIAL PROFILE —  [label | acquirer | target]');
  showRows(await tableRows('850px'));
  console.log('    BASIS NOTE:', pick(await sectionText('850px'), /Basis of presentation:[\s\S]{0,300}/i));

  await p.screenshot({ path: `/tmp/nongaap_${AT}_${TT}.png`, fullPage: false });
  console.log('\n  [page errors:', errs.length, errs.length?':: '+errs.slice(0,3).join(' | '):'', ']');
} catch(e){ console.log('ERR',e.message, e.stack); } finally { await b.close(); }
