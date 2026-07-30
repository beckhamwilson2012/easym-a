// DIAGNOSTIC (read-only). Loads <AT> acquires <TT>, builds, and dumps the chart slides + bug-sweep
// slides' innerText so we can read real rendered values. Usage: node scripts/diag_deckaudit.mjs <AT> <AN> <TT> <TN>
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
const clickTab = async (label)=>{ const ok=await p.evaluate(lbl=>{const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && e.textContent.trim()===lbl);if(el){el.click();return true;}return false;}, label); await sleep(1600); return ok; };
const sectionText = (mw='850px')=> p.evaluate(m=>{const w=[...document.querySelectorAll('div')].find(d=>d.style.maxWidth===m);return w?w.innerText:'';}, mw);
const dump = (label, txt)=>{ console.log(`\n===== ${label} =====`); console.log(txt.split('\n').map(l=>l.trim()).filter(Boolean).slice(0,40).join('\n')); };
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2500);
  console.log(`#### DECK AUDIT — ${AN}(${AT}) acquires ${TN}(${TT}) ####`);
  for (const tab of ['Quarterly Revenue Trend','Relative Contribution','Distribution of Stock Price','Equity Performance','Trading Profile & Ownership']) {
    const ok = await clickTab(tab);
    if (!ok) { console.log(`\n===== ${tab} ===== (TAB NOT FOUND)`); continue; }
    await sleep(1800); // async charts
    dump(tab, await sectionText('850px'));
  }
  console.log('\n  [page errors:', errs.length, errs.length?':: '+errs.slice(0,3).join(' | '):'', ']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
