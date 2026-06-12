import { chromium } from "playwright";
const [url, tab, out] = process.argv.slice(2);
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:1440,height:900} });
const p = await c.newPage();
await p.goto(url, {waitUntil:"domcontentloaded", timeout:30000}).catch(()=>{});
await p.waitForTimeout(11000);
if (tab) {
  await p.evaluate((t)=>{ const A=window.Alpine; const r=document.querySelector("[x-data]"); if(A&&r){ const d=A.$data(r); if(d){ d.page=t; if("view" in d) d.view="main"; } } }, tab).catch(()=>{});
  await p.waitForTimeout(8000);
}
await p.screenshot({ path: out });
await b.close(); console.log("shot:", out);
