// DIAGNOSTIC. Builds a deck and dumps the rendered text lines that assert an EPS/synergy BASIS,
// to confirm the stale-label batch fix. Usage: node scripts/diag_labels.mjs <AT> <AN> <TT> <TN>
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT=process.argv[2], AN=process.argv[3], TT=process.argv[4], TN=process.argv[5];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const bodyText = () => p.evaluate(()=>document.body.innerText);
const wait = async (re,t=20000)=>{const s=Date.now();while(Date.now()-s<t){if(re.test(await bodyText()))return true;await sleep(300);}return false;};
const load = async (i,tk,nm)=>{const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:45});await sleep(1200);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true;}return false;});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1500);};
const clk = async re=>{await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click();},re.source);await sleep(1100);};
const setOffer = async ()=>{const m=(await bodyText()).match(/Suggested:\s*\$?([\d.]+)\/share/i);if(m){await p.evaluate(v=>{const el=document.querySelector('input[name="offerPricePerShare"]');if(!el)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();},m[1]);await sleep(400);}};
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2200);
  // collect ALL rendered text (every section is in the DOM)
  const full = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  const grabAround = s => { const i=full.indexOf(s); return i<0 ? null : full.slice(Math.max(0,i-15), i+s.length+25).trim(); };
  const check = (title, present, absent)=>{ const f=grabAround(present); const a=absent?grabAround(absent):null; console.log(`\n-- ${title} --`); console.log('  NEW present :', f? '✓ …'+f+'…' : '✗ NOT FOUND'); if(absent) console.log('  OLD absent  :', a? '✗ STILL PRESENT: …'+a+'…' : '✓ gone'); };
  console.log(`### ${AN}(${AT}) acquires ${TN}(${TT}) — basis-label check ###`);
  check('Sources methodology bullet', "reported diluted EPS (the filed per-share figure)", "net income ÷ shares outstanding on a single consistent basis");
  check('Target Overview EPS row label', "Diluted EPS", "EPS (NI ÷ shares)");
  check('Exchange Ratio basis label', "Reported diluted EPS (net income ÷ diluted shares as fallback)", "GAAP-equivalent (net income ÷ shares)");
  check('Synergy Overview caption (standard)', "% of target revenue — within typical M&A", "of combined entity revenue");
  check('Synergy Overview caption (bank — only on bank deals)', "% of target non-interest expense", "of combined non-interest expense");
  console.log('\n[page errors: '+errs.length+(errs.length?' :: '+errs.slice(0,2).join(' | '):'')+']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
