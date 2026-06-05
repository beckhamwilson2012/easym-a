import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2200'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2200 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
async function waitForText(re, t=16000){const s=Date.now();while(Date.now()-s<t){if(re.test(await page.evaluate(()=>document.body.innerText)))return true;await sleep(300);}return false;}
async function loadTicker(i,tk,nm){const ins=await page.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:40});await sleep(1000);const c=await page.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true}return false});if(!c)await ins[i].press('Enter');await waitForText(new RegExp(nm,'i'));await sleep(1200);}
async function setNumber(n,v){const s=`input[name="${n}"]`;await page.waitForSelector(s);await page.evaluate((s,val)=>{const el=document.querySelector(s);const st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;st.call(el,val);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();},s,String(v));await sleep(300);}
async function clickBtn(re){await page.evaluate(s=>{const b=[...document.querySelectorAll('button')].find(x=>new RegExp(s,'i').test(x.textContent));if(b)b.click();},re.source);await sleep(1200);}
// read only the VISIBLE active section by hiding the offscreen PDF container
async function activeText(){return page.evaluate(()=>{const hid=document.querySelector('[aria-hidden="true"]');const prev=hid?hid.style.display:null;if(hid)hid.style.display='none';const scroll=[...document.querySelectorAll('div')].find(d=>{const s=getComputedStyle(d);return s.overflowY==='auto'&&d.offsetHeight>300;});const txt=(scroll||document.body).innerText;if(hid)hid.style.display=prev;return txt.replace(/\n{2,}/g,'\n').trim();});}

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clickBtn(/Auto-Lookup/);
  await loadTicker(0,'CRM','Salesforce'); await loadTicker(1,'TEAM','Atlassian');
  await setNumber('offerPricePerShare',150);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('Base'));if(b)b.click();});
  await sleep(400); await clickBtn(/Build merger model/); await sleep(1500);
  await page.mouse.click(750,400);
  const NAMES=['0 dashboard','1 TITLE','2 COMPARABLES','3 COMPANY PROFILES','4 STANDALONE P&L ACQUIRER','5 STANDALONE P&L TARGET','6 FINANCIAL PROFILE','7 PRO FORMA + ACCRETION','8 EQUITY PERF','9 TRADING/OWNERSHIP','10 RELATIVE CONTRIBUTION','11 DISTRIBUTION','12 ANALYST','13 VALUATION MATRIX','14 SOURCES','15 DATA VERIFICATION'];
  const dump=[3,4,5,6,7,9,10,12,14]; // sections to print fully
  for(let idx=0;idx<=15;idx++){
    if(dump.includes(idx)){
      const t=await activeText();
      console.log('\n========================= '+NAMES[idx]+' =========================');
      console.log(t.slice(0,1400));
    }
    await page.keyboard.press('ArrowRight'); await sleep(550);
  }
  console.log('\nTOTAL errors:', errors.length);
  if(errors.length) console.log(errors.slice(0,8).join('\n'));
} catch(e){ console.log('ERROR',e.message);} finally { await browser.close(); }
