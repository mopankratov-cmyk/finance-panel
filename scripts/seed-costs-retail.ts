// Сидер себестоимости Retail Family (куртки/ветровки NV-/HT-).
// Источник цифр: docs/retail-family-analytics.md §1 (со слов пользователя).
//   Куртки NV- (кроме NV-08): себест 1600 (NV-816: 1650), фулфилмент 180 ₽
//   Ветровки HT- и NV-08:      себест 1100 (NV-08: 950),   фулфилмент 100 ₽
// Артикулы тянем динамически из wb_orders по кабинету Retail Family.
// Не-одежда (косметика BM*, сумки, доски, наколенники...) НЕ сидится — выводится списком для ручного ввода.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});

const RETAIL_FAMILY="1f173bb0-e687-4f06-9bb8-a1a44d5621bf";
const ENTITY="Retail Family"; // юрлицо-плейсхолдер — пользователь подтвердит/переименует

// Возвращает {cost, ff, name} для одежды NV-/HT-, либо null если не одежда.
function clothingCost(article:string):{cost:number;ff:number;cls:string}|null{
  const a=article.toUpperCase();
  if(a.startsWith("NV-08")) return {cost:950, ff:100, cls:"ветровка"};   // дешёвая куртка
  if(a.startsWith("NV-816")) return {cost:1650, ff:180, cls:"куртка"};
  if(a.startsWith("NV-")) return {cost:1600, ff:180, cls:"куртка"};       // NV-01, NV-836, прочие
  if(a.startsWith("HT-")||a.startsWith("HT")) return {cost:1100, ff:100, cls:"ветровка"};
  return null;
}

async function fetchAll(table:string,cols:string,filt:(q:any)=>any){const out:any[]=[];let from=0;const page=1000;for(;;){let q=sb.from(table).select(cols).range(from,from+page-1);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}out.push(...(data??[]));if(!data||data.length<page)break;from+=page;}return out;}

async function main(){
  // distinct supplier_article у Retail Family
  const ord=await fetchAll("wb_orders","supplier_article",(q)=>q.eq("cabinet_id",RETAIL_FAMILY));
  const arts=[...new Set(ord.map((o:any)=>String(o.supplier_article||"")).filter(Boolean))].sort();
  console.log("Retail Family: distinct артикулов в заказах =",arts.length);

  // что уже есть в product_costs (чтобы не трогать)
  const{data:pcExisting}=await sb.from("product_costs").select("article");
  const have=new Set((pcExisting??[]).map((p:any)=>String(p.article)));

  const toSeed:any[]=[]; const skipNonClothing:string[]=[]; const alreadyHave:string[]=[];
  for(const a of arts){
    const c=clothingCost(a);
    if(!c){ if(have.has(a))alreadyHave.push(a); else skipNonClothing.push(a); continue; }
    toSeed.push({
      article:a,
      brand:"Retail Family",
      entity:ENTITY,
      name:`${c.cls[0].toUpperCase()+c.cls.slice(1)} ${a}`,
      cost_rub:c.cost,
      warehouse_expenses:c.ff,
    });
  }

  console.log(`\nК загрузке (одежда NV-/HT-): ${toSeed.length}`);
  for(const r of toSeed) console.log(`  ${r.article}  cost=${r.cost_rub} ff=${r.warehouse_expenses}  (${r.name})`);

  if(toSeed.length){
    const{error}=await sb.from("product_costs").upsert(toSeed,{onConflict:"article"});
    if(error){console.error("UPSERT ERROR:",error.message);process.exit(1);}
    console.log(`\n✅ Загружено/обновлено ${toSeed.length} артикулов Retail Family (entity="${ENTITY}").`);
  }

  console.log(`\n⚠️  НЕ одежда — нужна себестоимость от пользователя (${skipNonClothing.length}):`);
  console.log(skipNonClothing.join("\n"));
  if(alreadyHave.length) console.log(`\n(уже были в product_costs, не трогал: ${alreadyHave.length})`);
}
main().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1);});
