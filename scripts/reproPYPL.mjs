import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c,m)=>{console.log(`${c?'✓':'✗ FAIL'}  ${m}`); if(!c)fail++;};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2200'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2200 });
page.on('pageerror', e => console.log('  [pageerror]', e.message));

async function waitForText(re,t=16000){const s=Date.now();while(Date.now()-s<t){if(re.test(await page.evaluate(()=>document.body.innerText)))return true;await sleep(300);}return false;}
async function loadTicker(i,tk,nm){const ins=await page.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:40});await sleep(1000);const c=await page.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true}return false});if(!c)await ins[i].press('Enter');await waitForText(new RegExp(nm,'i'));await sleep(1500);}
async function clickBtn(re){await page.evaluate(s=>{const b=[...document.querySelectorAll('button')].find(x=>new RegExp(s,'i').test(x.textContent));if(b)b.click();},re.source);await sleep(1200);}

try {
  await page.goto('http://localhost:3000', { waitUntil:'networkidle2', timeout:30000 });
  await clickBtn(/Auto-Lookup/);
  console.log('── Loading MSFT (acquirer) / PYPL (target) ──');
  await loadTicker(0,'MSFT','Microsoft');
  await loadTicker(1,'PYPL','PayPal');

  // 1) live price loaded into the target panel summary ("· $XX.XX mkt")
  const panel = await page.evaluate(()=>document.body.innerText);
  const mkt = panel.match(/\$\s?([\d.]+)\s*mkt/i);
  ok(mkt && parseFloat(mkt[1]) > 1, `Live price loaded for PYPL (panel shows ${mkt? '$'+mkt[1]+' mkt':'NO mkt price'})`);

  // suggested offer badge should be a positive premium over the live price
  const badge = panel.match(/Suggested:\s*\$?([\d.]+)\/share\s*\((\d+)% premium\)/i);
  ok(badge && parseInt(badge[2],10) > 0, `Suggested offer is a POSITIVE premium (${badge? badge[2]+'%':'not shown'})`);

  // use the suggested offer (or it auto-fills on build) then build
  await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Use this/i.test(x.textContent));if(b)b.click();});
  await sleep(400);
  await clickBtn(/Build merger model/);
  await sleep(1200);

  const dash = await page.evaluate(()=>document.body.innerText);
  // 2) premium positive on dashboard
  const prem = dash.match(/Purchase Premium\s*([+\-]?[\d.]+)%/i);
  ok(prem && parseFloat(prem[1]) > 0, `Dashboard Purchase Premium is POSITIVE (got ${prem? prem[1]+'%':'N/A'})`);
  ok(!(prem && parseFloat(prem[1]) < 0), 'Premium is NOT negative (no below-market offer)');

  // 3) sensitivity rows vary — collect the "N% premium" + "$X/share" pairs
  const rows = [...dash.matchAll(/(\d+)% premium\s*\$([\d.]+)\/share/gi)].map(m=>({prem:m[1], price:m[2]}));
  console.log('  sensitivity rows:', JSON.stringify(rows));
  const distinctPrem = new Set(rows.map(r=>r.prem));
  const distinctPrice = new Set(rows.map(r=>r.price));
  ok(rows.length >= 5, `Sensitivity has ${rows.length} rows`);
  ok(distinctPrem.size >= 4, `Sensitivity premiums VARY (${distinctPrem.size} distinct: ${[...distinctPrem].join('/')}%)`);
  ok(distinctPrice.size >= 4, `Sensitivity prices VARY (${distinctPrice.size} distinct)`);

  // verdict present
  ok(/✓ Accretive|✗ Dilutive/.test(dash), 'Verdict shown');
  console.log(`\n${fail===0?'✅ PYPL REPRO ALL PASS':'❌ '+fail+' FAILED'}`);
} catch(e){ console.log('ERROR', e.message); fail++; }
finally { await browser.close(); process.exit(fail===0?0:1); }
