import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2200'] });
const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 2200 });
const logs = [];
page.on('console', m => { const t = m.text(); if (/buildAutoRow/.test(t)) logs.push(t); });
async function wait(re,t=18000){const s=Date.now();while(Date.now()-s<t){if(re.test(await page.evaluate(()=>document.body.innerText)))return true;await sleep(300)}return false}
async function load(i,tk,nm){const ins=await page.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:40});await sleep(1000);const c=await page.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true}return false});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1500)}
async function clk(re){await page.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click()},re.source);await sleep(1200)}
async function activeText(){return page.evaluate(()=>{const h=document.querySelector('[aria-hidden="true"]');const p=h?h.style.display:null;if(h)h.style.display='none';const sc=[...document.querySelectorAll('div')].find(d=>{const s=getComputedStyle(d);return s.overflowY==='auto'&&d.offsetHeight>300});const t=(sc||document.body).innerText;if(h)h.style.display=p;return t.replace(/\n{2,}/g,'\n').trim()})}
try{
  await page.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,'CRM','Salesforce'); await load(1,'TEAM','Atlassian');
  const m=(await page.evaluate(()=>document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if(m){await page.evaluate(v=>{const el=document.querySelector('input[name="offerPricePerShare"]');const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur()},m[1]);await sleep(400)}
  await clk(/Build merger model/); await sleep(1200);
  await page.mouse.click(750,400);
  await page.keyboard.press('ArrowRight'); await sleep(500); // title
  await page.keyboard.press('ArrowRight'); await sleep(500); // comparables
  await wait(/ORCL|Oracle/i, 12000); await sleep(2500); // let peer prices resolve
  console.log('===== COMPARABLES TABLE (after Fix 1) =====');
  console.log(await activeText());
  console.log('\n===== buildAutoRow logs (EV path per peer) =====');
  console.log([...new Set(logs)].join('\n'));
}catch(e){console.log('ERR',e.message)}finally{await browser.close()}
