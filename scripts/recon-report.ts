import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) { let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[m[1]])process.env[m[1]]=v; }
  }
}
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false,autoRefreshToken:false} });

const CABINET_ID = "1f173bb0-e687-4f06-9bb8-a1a44d5621bf"; // Retail Family
const REPORT_URL = "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";
const DATE_FROM = "2026-02-01";
const DATE_TO = "2026-06-17";
const CUT = "2026-03-23";

function klass(a: string): "куртка"|"ветровка"|"?" {
  const s=String(a||"").toUpperCase();
  if(s.startsWith("NV")) return "куртка";   // ВСЕ NV- = куртки (вкл. NV-08)
  if(s.startsWith("HT")) return "ветровка"; // ветровки = только HT-
  return "?";
}
const n=(x:any)=>{const v=Number(x);return Number.isFinite(v)?v:0;};

async function fetchPage(token:string,rrdid:number):Promise<any[]|null>{
  for(let attempt=0;attempt<4;attempt++){
    if(attempt>0) await new Promise(r=>setTimeout(r,3000*attempt));
    const url=new URL(REPORT_URL);
    url.searchParams.set("dateFrom",DATE_FROM); url.searchParams.set("dateTo",DATE_TO);
    url.searchParams.set("limit","50000"); url.searchParams.set("rrdid",String(rrdid));
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),90000);
    try{
      const res=await fetch(url.toString(),{headers:{Authorization:token},signal:ctrl.signal});
      clearTimeout(t);
      if(!res.ok){ if([429,500,502,503,504].includes(res.status)){console.error("retry HTTP",res.status);continue;} console.error("HTTP",res.status,(await res.text()).slice(0,150)); return null; }
      return await res.json() as any[];
    }catch(e){ clearTimeout(t); console.error("retry fetch err",(e as Error).message); }
  }
  return null;
}
async function fetchReport(token: string) {
  const all:any[]=[]; let rrdid=0;
  for(let page=0;page<200;page++){
    const chunk=await fetchPage(token,rrdid);
    if(chunk===null){ console.error("page failed permanently, stopping with",all.length); break; }
    if(chunk.length===0) break;
    all.push(...chunk);
    process.stderr.write(`  page ${page}: +${chunk.length} (total ${all.length})\n`);
    if(chunk.length<50000) break;
    let mx=0; for(const r of chunk){const id=Number(r.rrd_id); if(id>mx)mx=id;}
    if(!mx||mx===rrdid) break; rrdid=mx;
  }
  return all;
}

async function main() {
  const { data: cab } = await sb.from("wb_cabinets").select("token").eq("id",CABINET_ID).maybeSingle();
  if(!cab?.token){ console.error("no token"); process.exit(1); }
  const CACHE="/tmp/rf-report.json";
  let rows:any[];
  if(existsSync(CACHE)){ rows=JSON.parse(readFileSync(CACHE,"utf8")); console.error("loaded cache",rows.length); }
  else { console.error("fetching report",DATE_FROM,"..",DATE_TO); rows=await fetchReport(cab.token as string); writeFileSync(CACHE,JSON.stringify(rows)); }
  console.log("rows:", rows.length);

  // куртки only (NV-*) — пользователь хочет именно куртку и последний период
  const jrows = rows.filter(r=>klass(r.sa_name as string)==="куртка");
  console.log("куртка rows:", jrows.length);

  // 1) Состав ДЕНЕГ по типам операций: где сидит логистика? Сумма всех числовых *_rub/cost полей
  console.log("\n=== КУРТКА: суммы ключевых полей по типу операции (весь период) ===");
  const FIELDS=["delivery_rub","rebill_logistic_cost","storage_fee","ppvz_for_pay","retail_amount","quantity","delivery_amount","return_amount","penalty","deduction","acceptance","acquiring_fee","additional_payment"];
  const byop:Record<string,Record<string,number>>={};
  for(const r of jrows){ const o=String(r.supplier_oper_name??"?"); (byop[o]??={}); for(const f of FIELDS){ byop[o][f]=(byop[o][f]??0)+n(r[f]); } byop[o].__cnt=(byop[o].__cnt??0)+1; }
  for(const [o,m] of Object.entries(byop).sort((a,b)=>b[1].__cnt-a[1].__cnt)){
    const big=FIELDS.filter(f=>Math.abs(m[f]||0)>1000).map(f=>`${f}=${Math.round(m[f]).toLocaleString()}`).join("  ");
    console.log(`  [${m.__cnt}] ${o}\n      ${big}`);
  }

  // 2) Логистика «по-честному» по периодам: forward(Логистика) + reverse(возврат+ПВЗ-возврат) на ВЫКУПЛЕННУЮ куртку
  function periodStats(label:string, after?:string, before?:string){
    let soldQ=0, retQ=0, deliveries=0, returns=0, allLog=0, rev_rub=0, forpay=0, acq=0, pen=0, ded=0;
    for(const r of jrows){
      const d=String(r.rr_dt??r.sale_dt??"").slice(0,10); if(!d) continue;
      if(after && d<after) continue; if(before && d>=before) continue;
      const op=String(r.supplier_oper_name??"").toLowerCase();
      allLog+=n(r.delivery_rub)+n(r.rebill_logistic_cost);
      deliveries+=n(r.delivery_amount); returns+=n(r.return_amount);
      acq+=n(r.acquiring_fee); pen+=n(r.penalty); ded+=n(r.deduction);
      if(op.includes("продаж")){ soldQ+=n(r.quantity); rev_rub+=n(r.retail_amount); forpay+=n(r.ppvz_for_pay); }
      if(op.includes("возврат")){ retQ+=n(r.quantity); rev_rub-=n(r.retail_amount); forpay-=n(r.ppvz_for_pay); }
    }
    const logPerSold=soldQ? allLog/soldQ:0;
    const buyoutOp=(soldQ+retQ)? soldQ/(soldQ+retQ)*100:0;
    const buyoutLegs=deliveries? soldQ/deliveries*100:0;
    const price=soldQ? rev_rub/soldQ:0;
    const commission=rev_rub-forpay; // удержано WB сверх к-перечислению (≈комиссия)
    // P&L на выкупленную куртку (себест+FF=1780)
    const cost=1780;
    const net = price - logPerSold - (acq/Math.max(soldQ,1)) - (pen/Math.max(soldQ,1)) - (commission/Math.max(soldQ,1)) - cost;
    const afterDrr = net - price*0.10;
    console.log(`\n--- ${label} ---  (продажи ${soldQ}, выручка ${Math.round(rev_rub).toLocaleString()})`);
    console.log(`  доставок ${deliveries} | возвратов(легов) ${returns} | возвраты(оп) ${retQ} | выкуп: по оп ${buyoutOp.toFixed(0)}%, по доставкам ${buyoutLegs.toFixed(0)}%`);
    console.log(`  цена/ед ${price.toFixed(0)} | ЛОГИСТИКА/выкупл ${logPerSold.toFixed(0)} (${rev_rub?(allLog/rev_rub*100).toFixed(0):0}%) | эквайринг/ед ${(acq/Math.max(soldQ,1)).toFixed(0)} | штраф/ед ${(pen/Math.max(soldQ,1)).toFixed(0)} | комиссия/ед ${(commission/Math.max(soldQ,1)).toFixed(0)}`);
    console.log(`  P&L/ед (себест+FF 1780): грязная ${net.toFixed(0)} (${price?(net/price*100).toFixed(0):0}%) | после ДРР10% ${afterDrr.toFixed(0)} (${price?(afterDrr/price*100).toFixed(0):0}%)`);
  }
  periodStats("ВЕСЬ период фев–июнь");
  periodStats("до 23.03", undefined, CUT);
  periodStats("после 23.03 (ИРП)", CUT);
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
