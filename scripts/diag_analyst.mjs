// DIAGNOSTIC. Loads <AT> acquires <TT>, builds, opens the Analyst Consensus slide (§12), and captures
// the forward-estimates block + the 3-source price-target source line for the TARGET (TT).
// Usage: node scripts/diag_analyst.mjs <AT> <AN> <TT> <TN>
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
const clickTab = async (label)=>{ await p.evaluate(lbl=>{const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && e.textContent.trim()===lbl);if(el)el.click();}, label); await sleep(1400); };
const sectionText = (mw='850px')=> p.evaluate(m=>{const w=[...document.querySelectorAll('div')].find(d=>d.style.maxWidth===m);return w?w.innerText:'';}, mw);
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2000);
  await clickTab('Analyst Consensus');
  // allow /api/estimates + /api/verified to resolve
  for (let i=0;i<30;i++){ if(/Forward Consensus Estimates|not available for/.test(await sectionText('850px'))) break; await sleep(400); }
  await sleep(800);
  const txt = await sectionText('850px');
  console.log(`### Analyst Consensus — target ${TN}(${TT}) ###`);
  const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
  // labels render UPPERCASE via CSS text-transform → innerText is uppercased; match case-insensitively.
  const grab = (label)=>{ const i=lines.findIndex(l=>l.toUpperCase()===label.toUpperCase()); return i>=0 && lines[i+1] ? lines[i+1] : '—'; };
  const cap = lines.find(l=>/^Consensus \$[\d.]/.test(l) && /source/i.test(l)) || '(caption not found)';
  console.log('— Consensus caption —', cap);
  console.log('— Stat boxes —  Consensus:', grab('Consensus'), '| High:', grab('High Target'), '| Low:', grab('Low Target'), '| # Analysts:', grab('# Analysts'));
  console.log('— Ratings —  Buy:', grab('Buy'), '| Hold:', grab('Hold'), '| Sell:', grab('Sell'));
  const foot = lines.filter(l=>/Price targets|FORECAST|consensus|Nasdaq|StockAnalysis|Financial Modeling Prep|not available/.test(l)).slice(-1)[0] || '';
  console.log('— Badge words in footnote (should be NONE) —', /flagged|verified across|cross-source spread/i.test(foot) ? 'FOUND ✗' : 'none ✓');
  // forward block
  const fi = lines.findIndex(l=>/FORWARD CONSENSUS ESTIMATES/i.test(l));
  console.log('— Forward block —', fi>=0 ? 'PRESENT' : 'absent');
  if (fi>=0) console.log('   ', lines.slice(fi+1, fi+13).join(' | '));
  const na = lines.find(l=>/forward revenue\/eps consensus not available/i.test(l));
  if (na) console.log('— Forward degrade line —', na);
  // Hard-fact badge proof: the Data Verification appendix still badges facts (verified/flagged ✓/⚠).
  await clickTab('Data Verification');
  await sleep(900);
  const dvl = (await sectionText('850px')).split('\n').map(l=>l.trim()).filter(Boolean);
  console.log('— Data Verification appendix (hard-fact badges) —');
  console.log('   summary:', dvl.filter(l=>/\d+\s+(verified|flagged|single|missing|forecast)/i.test(l)).join(' | ') || '(n/a)');
  console.log('   analyst rows flagged?', /Analyst Target[\s\S]{0,40}⚠/.test(dvl.join('\n')) ? 'YES ✗' : 'no ✓ (no ⚠ on analyst rows)');
  const ci = dvl.findIndex(l=>/^Current Price$/i.test(l));
  if (ci>=0) console.log('   Current Price row:', dvl.slice(ci, ci+5).join(' | '));
  // source footnote (last italic line — contains "target" / "Forward")
  const src = lines.filter(l=>/Analyst|Forward|Financial Modeling Prep|Nasdaq|StockAnalysis/.test(l)).slice(-1)[0];
  console.log('— Source footnote —\n   ', (src||'(none)'));
  console.log('  [page errors:', errs.length, errs.length?':: '+errs.slice(0,2).join(' | '):'', ']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
