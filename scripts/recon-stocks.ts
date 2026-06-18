import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
async function fetchAll(table:string,cols:string,filt:(q:any)=>any){const out:any[]=[];let from=0;const page=1000;for(;;){let q=sb.from(table).select(cols).range(from,from+page-1);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}out.push(...(data??[]));if(!data||data.length<page)break;from+=page;}return out;}

const KCOST=(a:string)=>{a=a.toUpperCase();if(a.startsWith("NV-08"))return 950;if(a.startsWith("NV-816"))return 1650;return 1600;};
const cls=(a:string)=>{a=a.toUpperCase();return a.startsWith("NV")?"куртка":a.startsWith("HT")?"ветровка":"?";};

async function main(){
  // map nm_id -> supplier_article (from orders, since stocks has only nm_id)
  const ord=await fetchAll("wb_orders","nm_id,supplier_article",(q)=>q.or("supplier_article.ilike.NV-%,supplier_article.ilike.HT%"));
  const nmArt=new Map<number,string>();
  for(const o of ord){if(!nmArt.has(Number(o.nm_id)))nmArt.set(Number(o.nm_id),String(o.supplier_article));}
  const nmIds=[...nmArt.keys()];

  // stocks
  const stocks:any[]=[];
  for(let i=0;i<nmIds.length;i+=200){const part=await fetchAll("wb_stocks","nm_id,warehouse,quantity,in_way_to_client,in_way_from_client,synced_at",(q)=>q.in("nm_id",nmIds.slice(i,i+200)));stocks.push(...part);}
  // overall stocks freshness + total table size
  const {data:fresh}=await sb.from("wb_stocks").select("synced_at").order("synced_at",{ascending:false}).limit(1);
  const {count:totalStockRows}=await sb.from("wb_stocks").select("*",{count:"exact",head:true});
  console.log("wb_stocks: всего строк",totalStockRows,"| последний синк",fresh?.[0]?.synced_at);
  console.log("остатки по нашим NV-/HT- nm:",stocks.length,"строк");

  type Agg={units:number,inway:number,cost:number,skus:Set<number>};
  const by:Record<string,Agg>={"куртка":{units:0,inway:0,cost:0,skus:new Set()},"ветровка":{units:0,inway:0,cost:0,skus:new Set()}};
  const perNm=new Map<number,{art:string,k:string,qty:number,inway:number}>();
  for(const s of stocks){
    const nm=Number(s.nm_id);const art=nmArt.get(nm)||"";const k=cls(art);if(k==="?")continue;
    const qty=Number(s.quantity||0),iw=Number(s.in_way_to_client||0);
    by[k].units+=qty;by[k].inway+=iw;by[k].cost+=qty*KCOST(art);by[k].skus.add(nm);
    const e=perNm.get(nm)??{art,k,qty:0,inway:0};e.qty+=qty;e.inway+=iw;perNm.set(nm,e);
  }
  console.log("\n=== ОСТАТКИ (на складах WB) ===");
  let totUnits=0,totCost=0;
  for(const k of ["куртка","ветровка"]){const a=by[k];totUnits+=a.units;totCost+=a.cost;
    console.log(`  ${k}: ${a.units} шт на складе (+${a.inway} в пути) | ${a.skus.size} SKU | стоимость по себест ~${Math.round(a.cost).toLocaleString()} ₽`);}
  console.log(`  ИТОГО: ${totUnits} шт | по себестоимости ~${Math.round(totCost).toLocaleString()} ₽`);
  // retail potential (план до СПП): куртка 12000, ветровка 7000
  const retail=by["куртка"].units*12000+by["ветровка"].units*7000;
  console.log(`  GMV-потенциал (план до СПП, куртка 12к/ветровка 7к): ~${Math.round(retail).toLocaleString()} ₽`);

  console.log("\n=== ТОП-10 SKU по остатку ===");
  for(const [nm,e] of [...perNm.entries()].sort((a,b)=>b[1].qty-a[1].qty).slice(0,10))
    console.log(`  ${e.art} (${e.k}) nm=${nm}: ${e.qty} шт${e.inway?` +${e.inway} в пути`:""}`);

  // пуховик stock check
  const puh=stocks.filter(s=>{const a=nmArt.get(Number(s.nm_id))||"";return /пух|down|PU/i.test(a);});
  console.log("\nпуховики в остатках:",puh.length?"есть":"НЕТ (новая категория)");
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
