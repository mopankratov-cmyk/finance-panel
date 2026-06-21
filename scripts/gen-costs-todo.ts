// Шаблон себестоимости для не-одежда артикулов Retail Family, которых нет в product_costs.
// Выводит CSV (article;name;orders_30d;revenue_30d;orders_all;cost_rub;warehouse_expenses;entity)
// — две последние тройки пустые, заполнить вручную. Сортировка по выручке за 30 дней.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
const RF="1f173bb0-e687-4f06-9bb8-a1a44d5621bf";
const isClothing=(a:string)=>{const u=a.toUpperCase();return u.startsWith("NV-")||u.startsWith("HT");};

async function fetchAll(table:string,cols:string,filt:(q:any)=>any){const out:any[]=[];let from=0;const page=1000;for(;;){let q=sb.from(table).select(cols).range(from,from+page-1);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}out.push(...(data??[]));if(!data||data.length<page)break;from+=page;}return out;}

async function main(){
  const since=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const ord=await fetchAll("wb_orders","supplier_article,date,finished_price,total_price,is_cancel",(q)=>q.eq("cabinet_id",RF));
  const{data:pc}=await sb.from("product_costs").select("article");
  const have=new Set((pc??[]).map((p:any)=>String(p.article)));

  type Agg={all:number;o30:number;rev30:number};
  const by=new Map<string,Agg>();
  for(const o of ord){
    const a=String(o.supplier_article||"");if(!a)continue;
    if(isClothing(a)||have.has(a))continue; // только не-одежда без себеса
    const g=by.get(a)??{all:0,o30:0,rev30:0};
    if(!o.is_cancel){g.all++; if(String(o.date).slice(0,10)>=since){g.o30++; g.rev30+=Number(o.finished_price??o.total_price??0);}}
    by.set(a,g);
  }
  const rows=[...by.entries()].map(([article,g])=>({article,...g})).sort((a,b)=>b.rev30-a.rev30);

  const header="article;name;orders_30d;revenue_30d;orders_all;cost_rub;warehouse_expenses;entity";
  const lines=rows.map(r=>`${r.article};;${r.o30};${Math.round(r.rev30)};${r.all};;;`);
  const csv=[header,...lines].join("\n")+"\n";
  writeFileSync(new URL("../docs/retail-family-costs-todo.csv",import.meta.url),csv);
  console.log(`Артикулов без себеса: ${rows.length}. Записан docs/retail-family-costs-todo.csv`);
  console.log("\nТоп-20 по выручке за 30 дней (что важнее всего заполнить):");
  console.log("article | заказы30 | выручка30 | заказы всего");
  for(const r of rows.slice(0,20)) console.log(`  ${r.article}  | ${r.o30} | ${Math.round(r.rev30).toLocaleString("ru-RU")} | ${r.all}`);
  const dead=rows.filter(r=>r.o30===0).length;
  console.log(`\n(${dead} из ${rows.length} артикулов без заказов за 30 дней — можно заполнить в последнюю очередь)`);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
