// DIAGNOSTIC. Verifies the synergy-preset target-scaling fix for CRM(acquirer)/TEAM(target).
// Pass 1: click "Base" preset -> read synergiesY1/2/3 input values + the live % captions + button labels.
// Pass 2: build with auto-fill (no preset) -> confirm Dashboard/§7 unchanged (~$104M Y1, ramps to $261M).
// Read-only against :3001. Usage: node scripts/diag_preset_target.mjs
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT='CRM', AN='Salesforce', TT='TEAM', TN='Atlassian';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const bodyText = () => p.evaluate(()=>document.body.innerText);
const wait = async (re,t=20000)=>{const s=Date.now();while(Date.now()-s<t){if(re.test(await bodyText()))return true;await sleep(300);}return false;};
const load = async (i,tk,nm)=>{const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:45});await sleep(1200);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true;}return false;});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1500);};
const clk = async re=>{await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click();},re.source);await sleep(1100);};
const setOffer = async ()=>{const m=(await bodyText()).match(/Suggested:\s*\$?([\d.]+)\/share/i);if(m){await p.evaluate(v=>{const el=document.querySelector('input[name="offerPricePerShare"]');if(!el)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();},m[1]);await sleep(400);}};
const activeText = ()=>p.evaluate(()=>{const h=document.querySelector('[aria-hidden="true"]');const pr=h?h.style.display:null;if(h)h.style.display='none';const sc=[...document.querySelectorAll('div')].find(d=>{const s=getComputedStyle(d);return s.overflowY==='auto'&&d.offsetHeight>300;});const t=(sc||document.body).innerText;if(h)h.style.display=pr;return t.replace(/\n{2,}/g,'\n').trim();});
const grab = async (idx,re)=>{await p.mouse.click(750,400);for(let k=0;k<idx;k++){await p.keyboard.press('ArrowRight');await sleep(330);}await sleep(1100);const t=await activeText();const out=[];const lines=t.split('\n');for(let i=0;i<lines.length;i++)if(re.test(lines[i]))out.push(lines[i].trim()+(i+1<lines.length&&/^[\(\-+$\d.]/.test((lines[i+1]||'').trim())?'  ->  '+lines[i+1].trim():''));for(let k=0;k<idx;k++){await p.keyboard.press('ArrowLeft');await sleep(100);}await sleep(200);return out;};
try {
  // ---- PASS 1: Base preset ----
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  const presetBtn = await p.evaluate(()=>{const btn=[...document.querySelectorAll('button')].find(x=>/Base/.test(x.textContent)&&/%/.test(x.textContent)&&/Y3=/.test(x.textContent));if(btn){btn.click();return btn.textContent.replace(/\s+/g,' ').trim();}return null;});
  await sleep(700);
  const fields = await p.evaluate(()=>['synergiesY1','synergiesY2','synergiesY3'].map(n=>{const el=document.querySelector(`input[name="${n}"]`);return n+'='+(el?el.value:'?');}));
  const captions = await p.evaluate(()=>[...document.querySelectorAll('div')].filter(d=>/% of (target|combined)/.test(d.textContent)&&d.children.length===0).map(d=>d.textContent.trim()));
  const allPresetBtns = await p.evaluate(()=>[...document.querySelectorAll('button')].filter(x=>/Y3=/.test(x.textContent)).map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  console.log('### PASS 1 — "Base" preset clicked (target-scaled) ###');
  console.log('  preset button labels:', JSON.stringify(allPresetBtns));
  console.log('  synergy input fields :', JSON.stringify(fields));
  console.log('  live % captions      :', JSON.stringify(captions));

  // ---- PASS 2: auto-fill (no preset) ----
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(1700); await p.mouse.click(750,400); await sleep(400);
  const dash = await activeText();
  const dy1 = (dash.match(/Year 1[\s\S]{0,40}?\$([\d,]+)M/i)||[])[1];
  console.log('\n### PASS 2 — auto-fill (calcSuggestedSynergy, must be UNCHANGED) ###');
  console.log('  Dashboard Year-1 synergy: $'+(dy1||'?')+'M');
  console.log('  §7 synergy line:', JSON.stringify(await grab(7,/Synergies of/i)));
  console.log('\n[page errors: '+errs.length+(errs.length?' :: '+errs.slice(0,2).join(' | '):'')+']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
