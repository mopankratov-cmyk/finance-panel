import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) { let v = m[2].trim(); if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1); if(!process.env[m[1]]) process.env[m[1]]=v; }
  }
}
loadEnv();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession:false, autoRefreshToken:false } });

async function fetchAll(table: string, cols: string, filt: (q:any)=>any) {
  const out:any[]=[]; let from=0; const page=1000;
  for(;;){ let q=sb.from(table).select(cols).range(from,from+page-1); q=filt(q); const {data,error}=await q; if(error){console.error(table,error.message);break;} out.push(...(data??[])); if(!data||data.length<page)break; from+=page; }
  return out;
}

function klass(a: string): "куртка"|"ветровка"|"?" {
  const s=a.toUpperCase();
  if(s.startsWith("NV-01")||s.startsWith("NV-816")||s.startsWith("NV-836")) return "куртка";
  if(s.startsWith("NV-08")||s.startsWith("HT")) return "ветровка";
  return "?";
}

async function main() {
  // cabinet ownership
  const { data: cabsRaw } = await sb.from("wb_orders").select("cabinet_id, supplier_article").or("supplier_article.ilike.NV-%,supplier_article.ilike.HT%").limit(2000);
  const cabCount = new Map<string,number>();
  for(const r of cabsRaw??[]){ const c=String(r.cabinet_id??"null"); cabCount.set(c,(cabCount.get(c)??0)+1); }
  console.log("=== cabinet_id для NV-/HT- заказов ===");
  for(const [c,n] of cabCount) console.log("  ",c,n);
  const { data: cabs } = await sb.from("wb_cabinets").select("id,name,seller_id,is_active");
  console.log("=== wb_cabinets ===");
  for(const c of cabs??[]) console.log("  ",c.id,"|",c.name,"| seller",c.seller_id,"| active",c.is_active);

  // orders NV- + HT-
  const orders = await fetchAll("wb_orders","nm_id,supplier_article,date,finished_price,is_cancel",
    (q)=>q.or("supplier_article.ilike.NV-%,supplier_article.ilike.HT%"));
  // HT specifics
  const ht = orders.filter(o=>String(o.supplier_article).toUpperCase().startsWith("HT"));
  console.log("\n=== HT- заказы ===", ht.length, "| пример артикулов:", [...new Set(ht.map(o=>o.supplier_article))].slice(0,8).join(", "));

  // classify & buyout cross-check via wb_sales by nm_id after 23 марта
  const cut="2026-03-23";
  const nmKlass=new Map<number,string>();
  for(const o of orders){ const k=klass(String(o.supplier_article)); if(k!=="?") nmKlass.set(Number(o.nm_id),k); }
  const nmIds=[...nmKlass.keys()];
  // sales for these nm
  const sales:any[]=[];
  for(let i=0;i<nmIds.length;i+=200){ const part=await fetchAll("wb_sales","nm_id,date,finished_price,for_pay",(q)=>q.in("nm_id",nmIds.slice(i,i+200))); sales.push(...part); }

  function agg(rows:any[], dateFld:string, after?:string){
    const r:Record<string,{cnt:number,sum:number}>={"куртка":{cnt:0,sum:0},"ветровка":{cnt:0,sum:0}};
    for(const x of rows){ if(after && String(x[dateFld]).slice(0,10)<after) continue; const k=nmKlass.get(Number(x.nm_id)); if(!k)continue; if(x.is_cancel)continue; r[k].cnt++; r[k].sum+=Number(x.finished_price??0); }
    return r;
  }
  const oAll=agg(orders.filter(o=>!o.is_cancel),"date");
  const oAfter=agg(orders.filter(o=>!o.is_cancel),"date",cut);
  const sAll=agg(sales,"date");
  const sAfter=agg(sales,"date",cut);

  console.log("\n=== ВЫКУП кросс-чек (sales/orders), весь период ===");
  for(const k of ["куртка","ветровка"]){
    const bp=oAll[k].cnt? sAll[k].cnt/oAll[k].cnt*100:0;
    console.log(`  ${k}: заказы ${oAll[k].cnt} (${Math.round(oAll[k].sum/1e6)}млн), выкупы ${sAll[k].cnt} (${Math.round(sAll[k].sum/1e6)}млн) → ${bp.toFixed(0)}%`);
  }
  console.log("=== после 23 марта ===");
  for(const k of ["куртка","ветровка"]){
    const bp=oAfter[k].cnt? sAfter[k].cnt/oAfter[k].cnt*100:0;
    console.log(`  ${k}: заказы ${oAfter[k].cnt}, выкупы ${sAfter[k].cnt} → ${bp.toFixed(0)}%  | ср.цена заказа ${oAfter[k].cnt?Math.round(oAfter[k].sum/oAfter[k].cnt):0}`);
  }

  // funnel data?
  const fn = nmIds.length? await fetchAll("wb_funnel_daily","nm_id,date,orders,buyouts,orders_sum,buyout_sum",(q)=>q.in("nm_id",nmIds.slice(0,200))) : [];
  console.log("\n=== wb_funnel_daily для NV-/HT- ===", fn.length, "строк");
  if(fn.length){
    let o=0,b=0; let dmin="9",dmax="0";
    for(const r of fn){ o+=Number(r.orders??0); b+=Number(r.buyouts??0); const d=String(r.date).slice(0,10); if(d<dmin)dmin=d; if(d>dmax)dmax=d; }
    console.log(`  период ${dmin}..${dmax} | orders=${o} buyouts=${b} → выкуп ${o?(b/o*100).toFixed(0):0}%`);
  }
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
