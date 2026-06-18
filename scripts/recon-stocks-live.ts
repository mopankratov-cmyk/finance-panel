import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const CABINET_ID="1f173bb0-e687-4f06-9bb8-a1a44d5621bf"; // Retail Family
const STOCKS_URL="https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2024-01-01";
const n=(x:any)=>{const v=Number(x);return Number.isFinite(v)?v:0;};
const cls=(a:string)=>{a=String(a||"").toUpperCase();return a.startsWith("NV")?"куртка":a.startsWith("HT")?"ветровка":"другое";};
const KCOST=(a:string)=>{a=String(a||"").toUpperCase();if(a.startsWith("NV-08"))return 950;if(a.startsWith("NV-816"))return 1650;if(a.startsWith("NV"))return 1600;if(a.startsWith("HT"))return 1100;return 0;};

async function main(){
  const {data:cab}=await sb.from("wb_cabinets").select("token").eq("id",CABINET_ID).maybeSingle();
  if(!cab?.token){console.error("no token");process.exit(1);}
  console.error("fetching live stocks...");
  let rows:any[]=[];
  for(let attempt=0;attempt<4;attempt++){
    if(attempt) await new Promise(r=>setTimeout(r,3000*attempt));
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),90000);
    try{const res=await fetch(STOCKS_URL,{headers:{Authorization:cab.token as string},signal:ctrl.signal});clearTimeout(t);
      if(!res.ok){console.error("HTTP",res.status,(await res.text()).slice(0,150));continue;}
      rows=await res.json();break;
    }catch(e){clearTimeout(t);console.error("err",(e as Error).message);}
  }
  console.log("живых строк остатков (всего по кабинету):",rows.length);

  // by category (наши NV/HT) — qty = quantity (на складе, доступно)
  type Agg={qty:number,full:number,iw:number,cost:number,arts:Set<string>,nm:Set<number>};
  const mk=():Agg=>({qty:0,full:0,iw:0,cost:0,arts:new Set(),nm:new Set()});
  const by:Record<string,Agg>={};
  const subjByClass:Record<string,Map<string,number>>={};
  for(const r of rows){
    const art=String(r.supplierArticle||"");const k=cls(art);
    (by[k]??=mk());const a=by[k];
    const qty=n(r.quantity),full=n(r.quantityFull),iw=n(r.inWayToClient);
    a.qty+=qty;a.full+=full;a.iw+=iw;a.cost+=qty*KCOST(art);a.arts.add(art);a.nm.add(n(r.nmId));
    (subjByClass[k]??=new Map());const sm=subjByClass[k];const subj=String(r.subject||"?");sm.set(subj,(sm.get(subj)||0)+qty);
  }
  console.log("\n=== ЖИВЫЕ ОСТАТКИ ПО КАТЕГОРИЯМ ===");
  for(const k of Object.keys(by)){const a=by[k];
    console.log(`  ${k}: ${a.qty} шт на складе | ${a.full} полный | +${a.iw} в пути | ${a.arts.size} артикулов / ${a.nm.size} nm | себест ~${Math.round(a.cost).toLocaleString()} ₽`);
    const subs=[...(subjByClass[k]?.entries()||[])].sort((x,y)=>y[1]-x[1]).slice(0,6);
    if(subs.length) console.log("     subjects:",subs.map(([s,q])=>`${s}=${q}`).join(", "));
  }
  // итог по нашим (NV+HT)
  const our=["куртка","ветровка"].map(k=>by[k]).filter(Boolean);
  const totQty=our.reduce((s,a)=>s+a.qty,0),totCost=our.reduce((s,a)=>s+a.cost,0);
  const totFull=our.reduce((s,a)=>s+a.full,0),totIw=our.reduce((s,a)=>s+a.iw,0);
  console.log(`\n  ИТОГО куртки+ветровки: ${totQty} шт (полный ${totFull}, в пути ${totIw}) | себест ~${Math.round(totCost).toLocaleString()} ₽`);
  const gmv=(by["куртка"]?.qty||0)*12000+(by["ветровка"]?.qty||0)*7000;
  console.log(`  GMV-потенциал (куртка 12к/ветровка 7к, план до СПП): ~${Math.round(gmv).toLocaleString()} ₽`);

  // ALL article prefixes present (чтобы увидеть пуховики/новые)
  const pref=new Map<string,{qty:number,cnt:number}>();
  for(const r of rows){const a=String(r.supplierArticle||"");const p=a.replace(/[-_].*$/,"").slice(0,6)||"(empty)";const e=pref.get(p)??{qty:0,cnt:0};e.qty+=n(r.quantity);e.cnt++;pref.set(p,e);}
  console.log("\n=== ВСЕ префиксы артикулов в остатках ===");
  for(const [p,e] of [...pref.entries()].sort((a,b)=>b[1].qty-a[1].qty)) console.log(`  ${p}: ${e.qty} шт (${e.cnt} строк)`);

  // warehouses
  const wh=new Map<string,number>();
  for(const r of rows){if(cls(String(r.supplierArticle))==="другое")continue;wh.set(String(r.warehouseName||"?"),(wh.get(String(r.warehouseName||"?"))||0)+n(r.quantity));}
  console.log("\n=== склады (наши NV/HT) ===");
  for(const [w,q] of [...wh.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${w}: ${q} шт`);
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
