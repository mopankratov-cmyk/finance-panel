import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
function loadEnv(){const raw=readFileSync(new URL("../.env.local",import.meta.url),"utf8");for(const line of raw.split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m){let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}}
loadEnv();
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
async function all(filt:(q:any)=>any){const o:any[]=[];let f=0;for(;;){let q=sb.from("wb_orders").select("date,finished_price,is_cancel,supplier_article").range(f,f+999);q=filt(q);const{data,error}=await q;if(error){console.error(error.message);break;}o.push(...(data??[]));if(!data||data.length<1000)break;f+=1000;}return o;}
function isoWeek(d:Date){const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+1-day);return t.toISOString().slice(0,10);}
async function main(){
  const rows=await all((q)=>q.or("supplier_article.ilike.NV-%,supplier_article.ilike.HT%"));
  const wk=new Map<string,number>();
  for(const r of rows){if(r.is_cancel)continue;const d=new Date(r.date);if(isNaN(+d))continue;const k=isoWeek(d);wk.set(k,(wk.get(k)||0)+Number(r.finished_price||0));}
  const arr=[...wk.entries()].filter(([k])=>k>="2026-01-26"&&k<="2026-06-15").sort();
  writeFileSync("/tmp/rf-deck/img/weekly.json",JSON.stringify(arr));
  console.log("weeks:",arr.length,"| peak:",Math.round(Math.max(...arr.map(a=>a[1]))).toLocaleString());
}
main().catch(e=>{console.error("FATAL",e);process.exit(1);});
