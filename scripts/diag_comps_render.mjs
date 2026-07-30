// DIAGNOSTIC. Loads <AT> acquires <TT>, opens the Comparables slide, confirms it renders with real peer
// columns + non-blank metric data (previously-failing tickers used to blank/zero).
// Usage: node scripts/diag_comps_render.mjs <AT> <AN> <TT> <TN>
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
const clickTab = async (label)=>{ await p.evaluate(lbl=>{const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && e.textContent.trim()===lbl);if(el)el.click();}, label); await sleep(1500); };
const sectionText = (mw='850px')=> p.evaluate(m=>{const w=[...document.querySelectorAll('div')].find(d=>d.style.maxWidth===m);return w?w.innerText:'';}, mw);
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2000);
  await clickTab('Comparables');
  await sleep(4000); // peer columns + per-peer /quote are async
  const txt = await sectionText('850px');
  const dollarCells = (txt.match(/\$[\d.,]+\s*[BMK]?/g)||[]).length;
  const multCells   = (txt.match(/\d+\.\d+x/g)||[]).length;
  const pctCells    = (txt.match(/\d+\.\d+%/g)||[]).length;
  const naCells     = (txt.match(/\bn\/a\b/gi)||[]).length;
  console.log(`### Comparables — ${AN}(${AT}) acquires ${TN}(${TT}) ###`);
  console.log('  $ cells:', dollarCells, '| x-mult cells:', multCells, '| % cells:', pctCells, '| n/a cells:', naCells);
  console.log('  populated?', (dollarCells>=4 || multCells>=2) ? 'YES — not blank/all-zero ✓' : 'NO — empty ✗');
  const prov = (txt.match(/(Peer set:[^.]*|Peers selected[^.]*|Limited peer coverage[^.]*)\./)||[])[0] || '(no provenance label found)';
  console.log('  PEER PROVENANCE LABEL:', prov);
  // verbatim a couple metric rows
  const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
  ['Revenue','EV /','EV/','Gross','Operating','EBITDA'].forEach(k=>{ const i=lines.findIndex(l=>l.toLowerCase().startsWith(k.toLowerCase())); if(i>=0) console.log('   '+lines.slice(i,i+2).join('  |  ').slice(0,150)); });
  await p.screenshot({ path: `/tmp/comps_${TT}.png` });
  console.log('  [page errors:', errs.length, errs.length?':: '+errs.slice(0,2).join(' | '):'', ']  /tmp/comps_'+TT+'.png');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
