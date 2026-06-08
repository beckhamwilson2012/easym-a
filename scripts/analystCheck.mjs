import puppeteer from 'puppeteer-core';
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--no-first-run','--window-size=1500,2200']});
const p=await b.newPage();await p.setViewport({width:1500,height:2200});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
async function wait(re,t=16000){const s=Date.now();while(Date.now()-s<t){if(re.test(await p.evaluate(()=>document.body.innerText)))return true;await sleep(300)}return false}
async function load(i,tk,nm){const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:40});await sleep(1000);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true}return false});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1500)}
async function clk(re){await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click()},re.source);await sleep(1200)}
async function activeText(){return p.evaluate(()=>{const hid=document.querySelector('[aria-hidden="true"]');const prev=hid?hid.style.display:null;if(hid)hid.style.display='none';const sc=[...document.querySelectorAll('div')].find(d=>{const s=getComputedStyle(d);return s.overflowY==='auto'&&d.offsetHeight>300});const t=(sc||document.body).innerText;if(hid)hid.style.display=prev;return t.replace(/\n{2,}/g,'\n').trim()})}
const tgt=process.argv[2]||'CRM', acq=process.argv[3]||'MSFT';
try{
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,acq,acq==='MSFT'?'Microsoft':acq); await load(1,tgt,tgt==='CRM'?'Salesforce':tgt==='TEAM'?'Atlassian':tgt);
  await p.evaluate(()=>{const el=document.querySelector('input[name="offerPricePerShare"]');const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,'300');el.dispatchEvent(new Event('input',{bubbles:true}));el.blur()});
  await sleep(400); await clk(/Build merger model/); await sleep(1500);
  await p.mouse.click(750,400);
  for(let i=0;i<12;i++){await p.keyboard.press('ArrowRight');await sleep(350)} // → Analyst Consensus
  await sleep(600);
  console.log('===== ANALYST CONSENSUS SLIDE (target '+tgt+') =====');
  console.log((await activeText()).slice(0,1100));
  console.log('\nerrors:',errs.length);
}catch(e){console.log('ERR',e.message)}finally{await b.close()}
