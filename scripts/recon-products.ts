import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});

const VOL_RANGES:[number,number][]=[[143,1],[287,2],[431,3],[719,4],[1007,5],[1061,6],[1115,7],[1169,8],[1313,9],[1601,10],[1655,11],[1919,12],[2045,13],[2189,14],[2405,15],[2621,16],[2837,17],[3053,18],[3269,19],[3485,20],[3700,21],[3915,22],[4130,23],[4345,24],[4560,25],[4877,26],[5193,27],[5509,28],[5825,29],[6141,30],[6457,31],[6773,32],[7089,33],[7405,34],[7721,35],[8037,36],[8353,37],[8669,38],[8985,39],[9301,40],[9617,41],[9933,42],[10249,43],[10565,44],[10881,45],[11197,46],[11513,47],[11829,48],[12145,49],[12461,50],[12777,51],[13093,52],[13409,53],[13725,54],[14041,55]];
function estBasket(vol:number){for(const [max,b] of VOL_RANGES)if(vol<=max)return b;return 55+Math.ceil((vol-14041)/316);}
async function resolveImg(nmId:number):Promise<string|null>{
  const vol=Math.floor(nmId/100000),part=Math.floor(nmId/1000);
  const build=(b:number,size:string)=>`https://basket-${String(b).padStart(2,"0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${size}/1.webp`;
  const est=estBasket(vol);const order=[est];for(let d=1;d<=6;d++)order.push(est+d,est-d);
  for(const b of order){if(b<1)continue;const url=build(b,"big");try{const r=await fetch(url,{method:"HEAD"});if(r.ok)return url;}catch{}}
  return null;
}
async function fetchAll(table:string,cols:string,filt:(q:any)=>any){const out:any[]=[];let from=0;const page=1000;for(;;){let q=sb.from(table).select(cols).range(from,from+page-1);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}out.push(...(data??[]));if(!data||data.length<page)break;from+=page;}return out;}

const isKurt=(a:string)=>a.toUpperCase().startsWith("NV");
const isVet=(a:string)=>a.toUpperCase().startsWith("HT");

async function main(){
  const orders=await fetchAll("wb_orders","nm_id,supplier_article,date,finished_price,is_cancel",(q)=>q.or("supplier_article.ilike.NV-%,supplier_article.ilike.HT%"));
  // aggregate by nm_id
  const byNm=new Map<number,{art:string,cnt:number,rev:number,k:string}>();
  for(const o of orders){if(o.is_cancel)continue;const a=String(o.supplier_article);const k=isKurt(a)?"куртка":isVet(a)?"ветровка":"?";if(k==="?")continue;const e=byNm.get(Number(o.nm_id))??{art:a,cnt:0,rev:0,k};e.cnt++;e.rev+=Number(o.finished_price??0);byNm.set(Number(o.nm_id),e);}
  const top=(k:string,n:number)=>[...byNm.entries()].filter(([,e])=>e.k===k).sort((a,b)=>b[1].rev-a[1].rev).slice(0,n);
  const picks=[...top("куртка",6),...top("ветровка",6)];
  mkdirSync("/tmp/rf-deck/img/products",{recursive:true});
  console.log("=== ТОП товары + фото ===");
  const manifest:any[]=[];
  for(const [nm,e] of picks){
    const url=await resolveImg(nm);
    let saved="";
    if(url){try{const r=await fetch(url);if(r.ok){const buf=Buffer.from(await r.arrayBuffer());const fn=`/tmp/rf-deck/img/products/${e.k}_${e.art.replace(/[^A-Za-z0-9-]/g,"")}.webp`;writeFileSync(fn,buf);saved=fn;}}catch(err){console.error("dl fail",nm);}}
    console.log(`  ${e.k} ${e.art} nm=${nm} rev=${Math.round(e.rev)} cnt=${e.cnt} | ${url?"IMG ok":"no img"} ${saved?"saved":""}`);
    manifest.push({nm,art:e.art,k:e.k,rev:Math.round(e.rev),cnt:e.cnt,url,file:saved});
  }
  writeFileSync("/tmp/rf-deck/img/products/manifest.json",JSON.stringify(manifest,null,2));

  // monthly наши продажи (orders, non-cancel) by class
  const months=new Map<string,{kc:number,kr:number,vc:number,vr:number}>();
  for(const o of orders){if(o.is_cancel)continue;const a=String(o.supplier_article);const k=isKurt(a)?"k":isVet(a)?"v":"?";if(k==="?")continue;const m=String(o.date).slice(0,7);const e=months.get(m)??{kc:0,kr:0,vc:0,vr:0};if(k==="k"){e.kc++;e.kr+=Number(o.finished_price??0);}else{e.vc++;e.vr+=Number(o.finished_price??0);}months.set(m,e);}
  console.log("\n=== НАШИ ПРОДАЖИ помесячно (заказы, не отменённые) ===");
  console.log("месяц    | куртки шт | куртки ₽   | ветровки шт | ветровки ₽  | ИТОГО ₽");
  let totK=0,totV=0,totKc=0,totVc=0;
  for(const m of [...months.keys()].sort()){const e=months.get(m)!;totK+=e.kr;totV+=e.vr;totKc+=e.kc;totVc+=e.vc;
    console.log(`${m} | ${String(e.kc).padStart(8)} | ${String(Math.round(e.kr)).padStart(10)} | ${String(e.vc).padStart(10)} | ${String(Math.round(e.vr)).padStart(10)} | ${Math.round(e.kr+e.vr).toLocaleString()}`);}
  console.log(`ИТОГО    | ${totKc} куртки ${Math.round(totK).toLocaleString()}₽ | ${totVc} ветровки ${Math.round(totV).toLocaleString()}₽ | ВСЕГО ${Math.round(totK+totV).toLocaleString()}₽`);
  writeFileSync("/tmp/rf-deck/img/products/monthly.json",JSON.stringify([...months.entries()].map(([m,e])=>({m,...e})),null,2));
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
