// DIAGNOSTIC. Verifies SectionQuarterlyTrend is now wired into the deck and renders.
// Builds <AT>/<TT>, clicks the "Quarterly Revenue Trend" tab, captures the slide text + chart.
// Saves a screenshot to /tmp/quarterly_<TT>.png. Usage: node scripts/diag_quarterly_wire.mjs <AT> <AN> <TT> <TN>
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT=process.argv[2], AN=process.argv[3], TT=process.argv[4], TN=process.argv[5];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--no-first-run','--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const bodyText = () => p.evaluate(()=>document.body.innerText);
const wait = async (re,t=20000)=>{const s=Date.now();while(Date.now()-s<t){if(re.test(await bodyText()))return true;await sleep(300);}return false;};
const load = async (i,tk,nm)=>{const ins=await p.$$('input[id^="react-select"]');await ins[i].click();await ins[i].type(tk,{delay:45});await sleep(1200);const c=await p.evaluate(()=>{const o=document.querySelector('[id^="react-select"][id*="option"]');if(o){o.click();return true;}return false;});if(!c)await ins[i].press('Enter');await wait(new RegExp(nm,'i'));await sleep(1500);};
const clk = async re=>{await p.evaluate(s=>{const x=[...document.querySelectorAll('button')].find(y=>new RegExp(s,'i').test(y.textContent));if(x)x.click();},re.source);await sleep(1100);};
const setOffer = async ()=>{const m=(await bodyText()).match(/Suggested:\s*\$?([\d.]+)\/share/i);if(m){await p.evaluate(v=>{const el=document.querySelector('input[name="offerPricePerShare"]');if(!el)return;const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();},m[1]);await sleep(400);}};
try {
  await p.goto('http://localhost:3000',{waitUntil:'networkidle2',timeout:30000});
  await clk(/Auto-Lookup/); await load(0,AT,AN); await load(1,TT,TN);
  await wait(/[\d.]+\s*mkt/i,9000); await sleep(800); await setOffer();
  await clk(/Build merger model/); await sleep(1800);
  // Click the new tab by its label
  const clicked = await p.evaluate(()=>{ const el=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && /^Quarterly Revenue Trend$/.test(e.textContent.trim())); if(el){ el.click(); return el.tagName+':'+el.textContent.trim(); } return null; });
  await sleep(800);
  await wait(/Quarterly Revenue Trend|not available/i, 12000); await sleep(1500); // allow async fetch
  const info = await p.evaluate(()=>{
    const t=document.body.innerText;
    const pick = re => (t.match(re)||[])[0] || null;
    const svgs = document.querySelectorAll('svg.recharts-surface').length;
    const bars = document.querySelectorAll('.recharts-bar-rectangle, .recharts-rectangle').length;
    const lines = document.querySelectorAll('.recharts-line-curve, path.recharts-line-curve').length;
    return {
      title: pick(/Quarterly Revenue Trend/i),
      subtitle: pick(/Last 8 quarters[^\n]*/i) || pick(/Source: SEC EDGAR[^\n]*/i),
      notAvailable: /not available for this filer/i.test(t),
      loading: /Loading quarterly data/i.test(t),
      rechartsSurfaces: svgs, barRects: bars, lineCurves: lines,
      qLabels: (t.match(/[A-Z][a-z]{2} '\d{2}/g)||[]).slice(0,8),
    };
  });
  await p.screenshot({ path: `/tmp/quarterly_${TT}.png` });
  console.log(`### ${AN}(${AT}) acquires ${TN}(${TT}) — Quarterly Revenue Trend slide ###`);
  console.log('  tab clicked:', clicked);
  console.log('  title:', info.title);
  console.log('  subtitle:', info.subtitle);
  console.log('  "not available" state:', info.notAvailable, '  still loading:', info.loading);
  console.log('  recharts surfaces:', info.rechartsSurfaces, '| bar rects:', info.barRects, '| YoY line curves:', info.lineCurves);
  console.log('  quarter labels on axis:', JSON.stringify(info.qLabels));
  console.log('  screenshot:', `/tmp/quarterly_${TT}.png`);
  console.log('  [page errors:', errs.length, errs.length?':: '+errs.slice(0,2).join(' | '):'', ']');
} catch(e){ console.log('ERR',e.message); } finally { await b.close(); }
