import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--no-first-run']});
const p=await b.newPage();await p.setViewport({width:1400,height:1800});
async function wait(re,t=16000){const s=Date.now();while(Date.now()-s<t){if(re.test(await p.evaluate(()=>document.body.innerText)))return true;await sleep(300)}return false}
async function load(i,tk,nm){const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:40});await sleep(1000);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true}return false});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1200)}
async function clk(re){await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click()},re.source);await sleep(1200)}
try{
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,'CRM','Salesforce'); await load(1,'TEAM','Atlassian');
  await p.evaluate(()=>{const el=document.querySelector('input[name="offerPricePerShare"]');const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,'150');el.dispatchEvent(new Event('input',{bubbles:true}));el.blur()});
  await sleep(400); await clk(/Build merger model/); await sleep(1200);
  const t=await p.evaluate(()=>document.body.innerText);
  const nm=(t.match(/n\/m/g)||[]).length;
  console.log('EV/EBITDA + P/E show "n/m":', /EV \/ EBITDA[^]*?n\/m/.test(t) || nm>=2, '(n/m count:',nm+')');
  console.log('reason "Target EBITDA is negative":', /Target EBITDA is negative/.test(t));
  console.log('reason "Target earnings are negative":', /Target earnings are negative/.test(t));
}catch(e){console.log('ERR',e.message)}finally{await b.close()}
