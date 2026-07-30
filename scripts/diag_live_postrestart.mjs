// DIAGNOSTIC ONLY. Renders CRM/TEAM on :3000 and captures the actual rendered values for:
//   §4 Salesforce P&L: diluted shares, diluted EPS, gross margin
//   §5 Atlassian P&L: gross margin
//   §0 Dashboard: accretion %
// Read-only against :3001. Usage: node scripts/diag_live_postrestart.mjs
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
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(1700); await p.mouse.click(750,400); await sleep(400);
  console.log(`### LIVE RENDER — ${AN}(${AT}) acquires ${TN}(${TT}) ###`);
  console.log('\n-- §4 P&L Acquirer (Salesforce) --');
  console.log('  '+(await grab(4,/Gross Margin|Gross Profit|Diluted EPS|Shares Outstanding|reported diluted|EPS of/i)).join('\n  ')||'(none)');
  console.log('\n-- §5 P&L Target (Atlassian) --');
  console.log('  '+(await grab(5,/Gross Margin|Gross Profit|Diluted EPS|reported diluted/i)).join('\n  ')||'(none)');
  console.log('\n-- §0 Dashboard (accretion) --');
  console.log('  '+(await grab(0,/Accret|Dilut|Pro Forma EPS|decreasing EPS|increasing EPS|breakeven/i)).join('\n  ')||'(none)');
  console.log('\n[page errors: '+errs.length+(errs.length?' :: '+errs.slice(0,2).join(' | '):'')+']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
