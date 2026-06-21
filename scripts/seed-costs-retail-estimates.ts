// ⚠️ ОЦЕНОЧНАЯ себестоимость для 46 не-одежда артикулов Retail Family (точных данных нет).
// Метод: себес ≈ фактическая средняя цена продажи (revenue/orders, всё время) × коэффициент категории.
// Коэф консервативный (косметика 0.25, прочее 0.30). В name — пометка «ОЦЕНКА», чтобы в юните было видно.
// Когда появятся реальные цифры — перезалить через seed-costs-retail (точные перекроют оценку по article).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const RF="1f173bb0-e687-4f06-9bb8-a1a44d5621bf";
const isClothing=(a:string)=>{const u=a.toUpperCase();return u.startsWith("NV-")||u.startsWith("HT");};

function cat(a:string):{cat:string;ratio:number}{
  const u=a.toLowerCase();
  if(a.startsWith("BM")||u.includes("крем")) return {cat:"косметика",ratio:0.25};
  if(u.includes("сумка")) return {cat:"сумка",ratio:0.30};
  if(u.includes("шлеп")||u.includes("шлёп")) return {cat:"шлёпанцы",ratio:0.30};
  if(u.includes("ортез")||u.includes("бандаж")||u.includes("наколен")) return {cat:"медтекстиль",ratio:0.30};
  if(u.includes("доска")) return {cat:"доска",ratio:0.30};
  return {cat:"прочее",ratio:0.30};
}

async function fetchAll(table:string,cols:string,filt:(q:any)=>any){const out:any[]=[];let from=0;const page=1000;for(;;){let q=sb.from(table).select(cols).range(from,from+page-1);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}out.push(...(data??[]));if(!data||data.length<page)break;from+=page;}return out;}

async function main(){
  const ord=await fetchAll("wb_orders","supplier_article,finished_price,total_price,is_cancel",(q)=>q.eq("cabinet_id",RF));
  const{data:pc}=await sb.from("product_costs").select("article");
  const have=new Set((pc??[]).map((p:any)=>String(p.article)));

  const agg=new Map<string,{sum:number;cnt:number}>();
  for(const o of ord){
    const a=String(o.supplier_article||"");if(!a||isClothing(a)||have.has(a)||o.is_cancel)continue;
    const g=agg.get(a)??{sum:0,cnt:0}; g.sum+=Number(o.finished_price??o.total_price??0); g.cnt++; agg.set(a,g);
  }

  const rows:any[]=[]; const skipped:string[]=[];
  for(const[a,g]of agg){
    if(g.cnt===0){skipped.push(a);continue;}
    const avg=g.sum/g.cnt; const c=cat(a); const cost=Math.round(avg*c.ratio);
    rows.push({article:a,brand:"Retail Family",entity:"Retail Family",name:`${c.cat} ${a} · себес ОЦЕНКА ~${Math.round(c.ratio*100)}% от цены`,cost_rub:cost,warehouse_expenses:0});
  }
  rows.sort((a,b)=>b.cost_rub-a.cost_rub);
  console.log(`Оценка себеса для ${rows.length} артикулов (пропущено без заказов: ${skipped.length}).`);
  for(const r of rows) console.log(`  ${r.article}  → себес≈${r.cost_rub}  [${r.name.split(" · ")[0]}]`);

  if(rows.length){
    const{error}=await sb.from("product_costs").upsert(rows,{onConflict:"article"});
    if(error){console.error("UPSERT ERROR:",error.message);process.exit(1);}
    console.log(`\n✅ Залито ${rows.length} ОЦЕНОЧНЫХ себесов (entity="Retail Family", пометка ОЦЕНКА в name).`);
  }
  if(skipped.length) console.log("\n(без заказов вообще, не оценивал:",skipped.join(", "),")");
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
