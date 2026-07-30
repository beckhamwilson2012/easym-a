// DIAGNOSTIC. Renders ADBE acquires CRM and verifies the APPLIED non-GAAP accretion flip end-to-end:
//   step 4: Dashboard EPS Analysis (baseline / pro-forma / %) + basis pill on non-GAAP
//   step 7: §4 acquirer displayed standalone EPS == the accretion baseline (no GAAP/non-GAAP split)
// Usage: node scripts/diag_nongaap_flip_render.mjs
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT=process.argv[2]||'ADBE', AN=process.argv[3]||'Adobe', TT=process.argv[4]||'CRM', TN=process.argv[5]||'Salesforce';
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
const pick=(t,re)=>{const m=t.match(re);return m?m[0].replace(/\s+/g,' ').trim():'(absent)';};
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(2000);

  // wait until §4 settles on a basis (either label appears — the deck decides one basis at build)
  await clickTab('Standalone P&L — Acquirer');
  let resolved=false; for(let i=0;i<40;i++){ if(/Operating Income \((?:Non-GAAP|GAAP)\)/.test(await sectionText('850px'))){resolved=true;break;} await sleep(500); }

  // Capture each display slide's profitability basis (the (Non-GAAP)/(GAAP) label it actually shows).
  const row = (txt, re) => pick(txt, re);
  const s4 = await sectionText('850px');
  const s4eps = row(s4, /Diluted EPS \((?:Non-GAAP|GAAP)\)\s*\$?[\d.]+/i) || row(s4, /Diluted EPS[^\n]*/i);
  const s4oi  = row(s4, /Operating Income \((?:Non-GAAP|GAAP)\)[^\n]*/i);
  await clickTab('Standalone P&L — Target');
  const s5 = await sectionText('850px');
  const s5eps = row(s5, /Diluted EPS \((?:Non-GAAP|GAAP)\)\s*\$?[\d.]+/i) || row(s5, /Diluted EPS[^\n]*/i);
  await clickTab('Financial Profile');
  const s6 = await sectionText('850px');
  const s6oi  = row(s6, /Operating Income \((?:Non-GAAP|GAAP)\)[^\n]*/i);
  const s6eps = row(s6, /EPS \((?:Non-GAAP|GAAP)\)[^\n]*/i);

  // Dashboard
  await clickTab('Dashboard');
  await sleep(800);
  const dash = await bodyText();
  const dpick = (re)=>pick(dash, re);
  console.log(`### ${AN}(${AT}) acquires ${TN}(${TT}) — UNIFIED DEAL BASIS (display + accretion) ###`);
  console.log('  (slide basis settled in browser:', resolved, ')');
  const pill = dpick(/(Non-GAAP|GAAP) basis/i);
  console.log('\n— DISPLAY basis (§4 acquirer / §5 target / §6 profile) —');
  console.log('   §4 acquirer:', s4oi, '|', s4eps);
  console.log('   §5 target  :', s5eps);
  console.log('   §6 profile :', s6oi, '|', s6eps);
  console.log('\n— ACCRETION basis (Dashboard) —');
  console.log('   basis pill        :', pill);
  console.log('   EPS Impact (head) :', dpick(/[+\-]?\d+\.\d+%\s*(accretive|dilutive)/i), '|', dpick(/✓ Accretive|✗ Dilutive/i));
  // Before → After → Change block
  const ba = dash.match(/Before\s*\n?\$?([\d.]+)[\s\S]{0,40}?After\s*\n?\$?([\d.]+)[\s\S]{0,40}?Change\s*\n?([+\-]?[\d.]+%)/i);
  if (ba) console.log('   Before/After/Chg  : baseline $' + ba[1] + '  →  pro-forma $' + ba[2] + '  =  ' + ba[3]);
  else console.log('   Before/After/Chg  :', dpick(/from \$[\d.]+ to \$[\d.]+/i));
  console.log('   narrative         :', dpick(/decreasing EPS[^.]*\.|increasing EPS[^.]*\./i));
  console.log('   breakeven         :', dpick(/Breakeven:\s*\$[\d.]+[^\n]*/i));

  console.log('\n— UNIFICATION: display basis == accretion basis, and §4 EPS == baseline —');
  const dispBasis = /Non-GAAP/.test(s4oi + s5eps + s6oi) ? 'Non-GAAP' : 'GAAP';
  const accrBasis = /Non-GAAP/i.test(pill) ? 'Non-GAAP' : 'GAAP';
  console.log('   display basis     :', dispBasis, '  accretion basis:', accrBasis, '  SAME:', dispBasis===accrBasis ? 'YES ✓' : 'NO ✗');
  const baseline = ba ? ba[1] : (dpick(/from \$([\d.]+)/i).match(/[\d.]+/)||[])[0];
  const s4val = (s4eps.match(/\$?([\d.]+)/)||[])[1];
  console.log('   baseline (dash)   : $' + baseline + '   §4 displayed: $' + s4val + '   MATCH:', baseline===s4val ? 'YES ✓' : 'NO ✗');

  // Capture the app's ACTUAL deal terms (live prices changed the auto-suggestion) so we can confirm the
  // rendered accretion is exactly what calculate() yields for THOSE terms on non-GAAP.
  const narr = dpick(/at \$[\d.]+\/share[\s\S]*?transaction costs?\.?/i);
  console.log('\n— deal terms (from narrative, for the recompute) —');
  console.log('  ', narr.slice(0, 300));
  const terms = {
    offer: parseFloat((dash.match(/at \$([\d.]+)\/share/i)||[])[1]),
    synergyY1: (()=>{ const m = dash.match(/Year 1 synergies of \$([\d.]+)([MB])/i); if(!m) return 0; return parseFloat(m[1]) * (m[2]==='B'?1000:1); })(),
  };
  console.log('  parsed: offer $' + terms.offer + '  synergyY1 $' + terms.synergyY1 + 'M');
  await p.screenshot({ path: '/tmp/nongaap_flip_dash.png' });
  console.log('\n  [page errors:', errs.length, errs.length?':: '+errs.slice(0,2).join(' | '):'', ']');
  // emit terms for the recompute step
  console.log('TERMS_JSON=' + JSON.stringify(terms));
} catch(e){ console.log('ERR',e.message, e.stack); } finally { await b.close(); }
