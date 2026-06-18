import { readFileSync } from "node:fs";
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
  if(s.startsWith("NV-01")||s.startsWith("NV-816")||s.startsWith("NV-836")) return "куртка";
  if(s.startsWith("NV-08")||s.startsWith("HT")) return "ветровка";
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
  console.error("fetching report",DATE_FROM,"..",DATE_TO);
  const rows = await fetchReport(cab.token as string);
  console.log("rows fetched:", rows.length);
  // operation types present
  const ops=new Map<string,number>();
  for(const r of rows){ const o=String(r.supplier_oper_name??"?"); ops.set(o,(ops.get(o)??0)+1); }
  console.log("=== supplier_oper_name ===");
  for(const [o,c] of [...ops.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${c}\t${o}`);

  type Acc={salesQ:number;retQ:number;rev:number;deliv:number;storage:number;comm:number;forpay:number;delivAmt:number};
  const mk=():Acc=>({salesQ:0,retQ:0,rev:0,deliv:0,storage:0,comm:0,forpay:0,delivAmt:0});
  const data:Record<string,Record<string,Acc>>={};
  const get=(per:string,k:string)=>{ (data[per]??={}); (data[per][k]??=mk()); return data[per][k]; };

  for(const r of rows){
    const k=klass(r.sa_name as string); if(k==="?") continue;
    const d=String(r.rr_dt??r.sale_dt??"").slice(0,10);
    const per = d && d>=CUT ? "после 23.03" : "до 23.03";
    const op=String(r.supplier_oper_name??"").toLowerCase();
    const isSale=op.includes("продаж");
    const isRet=op.includes("возврат");
    const a=get(per,k);
    if(isSale){ a.salesQ+=n(r.quantity); a.rev+=n(r.retail_amount); a.comm+=n(r.ppvz_sales_commission); a.forpay+=n(r.ppvz_for_pay); }
    if(isRet){ a.retQ+=n(r.quantity); a.rev-=n(r.retail_amount); a.forpay-=n(r.ppvz_for_pay); }
    a.deliv+=n(r.delivery_rub)+n(r.rebill_logistic_cost);
    a.storage+=n(r.storage_fee);
    a.delivAmt+=n(r.delivery_amount);
  }

  for(const per of ["до 23.03","после 23.03"]){
    console.log(`\n========== ${per} ==========`);
    for(const k of ["куртка","ветровка"]){
      const a=data[per]?.[k]; if(!a){console.log(`  ${k}: нет данных`);continue;}
      const net=a.salesQ-a.retQ;
      const buyout=(a.salesQ+a.retQ)? a.salesQ/(a.salesQ+a.retQ)*100:0;
      const logPerSold=a.salesQ? a.deliv/a.salesQ:0;
      const logPerNet=net? a.deliv/net:0;
      const commPct=a.rev? a.comm/a.rev*100:0;
      console.log(`  ${k}: продажи ${a.salesQ} шт | возвраты ${a.retQ} | нетто ${net} | выкуп ${buyout.toFixed(0)}%`);
      console.log(`     выручка ${Math.round(a.rev).toLocaleString()} | логистика ${Math.round(a.deliv).toLocaleString()} | хранение ${Math.round(a.storage).toLocaleString()}`);
      console.log(`     ЛОГИСТИКА на проданную ед: ${logPerSold.toFixed(0)} ₽ | на нетто-ед: ${logPerNet.toFixed(0)} ₽ | поставок ${a.delivAmt}`);
      console.log(`     комиссия WB: ${commPct.toFixed(1)}% от выручки | к перечислению ${Math.round(a.forpay).toLocaleString()}`);
    }
  }
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
