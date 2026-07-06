// Живая валидация канона промптинга: per-model Nano body (#2/#3) + Scope-формула + 9:16, на реальных WB-фото.
// usage: npx tsx scripts/validate-canon.mts EN000813 TT06103
import fs from "node:fs"; import { createHash } from "node:crypto";
import { buildEditPrompt, categoryFor } from "../lib/factory/editPrompts";
function loadEnv(){for(const p of [".env.local","/Users/maksimpankratov/finance-panel/.env.local"]){try{const t=fs.readFileSync(p,"utf8");const e:Record<string,string>={};for(const l of t.split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,"");}return e;}catch{}}throw new Error("нет .env.local");}
const env=loadEnv(); const SB=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL!, KEY=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE!, FAL=env.FAL_KEY!;
const H={apikey:KEY,authorization:`Bearer ${KEY}`}, BUCKET="factory-media";
const PRODUCTS:Record<string,string>={EN000813:"корейский тональный кушон в компактном футляре", TT06103:"детский водный бластер-пистолет", CLR00912:"коричневая кожаная сумка-тоут", "HT-80-02":"мужская демисезонная куртка"};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

// per-model тело Nano (как прод editBody): aspect_ratio под op, safety_tolerance/output_format — Nano-only
async function nano(image_urls:string[], prompt:string, op:"clean"|"stage"):Promise<string|null>{
  const body={prompt,image_urls,num_images:1,aspect_ratio:op==="stage"?"9:16":"1:1",safety_tolerance:"6",output_format:"png"};
  const sub=await (await fetch("https://queue.fal.run/fal-ai/nano-banana/edit",{method:"POST",headers:{Authorization:`Key ${FAL}`,"Content-Type":"application/json"},body:JSON.stringify(body)})).json().catch(()=>({}));
  if(!sub.response_url)return null;
  for(let i=0;i<40;i++){await sleep(4000);const st=await (await fetch(`${sub.response_url}/status`,{headers:{Authorization:`Key ${FAL}`}})).json().catch(()=>({}));if(st.status==="COMPLETED"){const r=await (await fetch(sub.response_url,{headers:{Authorization:`Key ${FAL}`}})).json();return r?.images?.[0]?.url||null;}if(st.detail)return null;}
  return null;
}
async function upload(buf:Buffer,dest:string){await fetch(`${SB}/storage/v1/object/${BUCKET}/${dest}`,{method:"POST",headers:{...H,"content-type":"image/png","x-upsert":"true"},body:buf as any});return `${SB}/storage/v1/object/public/${BUCKET}/${dest}`;}

fs.mkdirSync("out",{recursive:true});
for(const art of process.argv.slice(2)){
  const wb=await (await fetch(`${SB}/rest/v1/content_assets?article=eq.${art}&disk=eq.wb&kind=eq.image&select=url&limit=1`,{headers:H})).json();
  if(!Array.isArray(wb)||!wb.length){console.log(`${art}: нет WB-фото`);continue;}
  const cat=categoryFor(art,""); const product=PRODUCTS[art]||"product";
  console.log(`\n──── ${art} · ${cat} · «${product}» ────`);
  const src=await upload(Buffer.from(await (await fetch(wb[0].url)).arrayBuffer()),`i2v-src/${art}-orig.png`); // рехост (WB-CDN флапает на fal)
  const clean=await nano([src],buildEditPrompt({category:cat,op:"clean",product}),"clean");
  if(!clean){console.log("  ❌ clean");continue;}
  const staged=await nano([clean,src],buildEditPrompt({category:cat,op:"stage",product}),"stage")||clean;
  const buf=Buffer.from(await (await fetch(staged)).arrayBuffer());
  const path=`prepared/${art}/${createHash("sha1").update(staged).digest("hex").slice(0,12)}-canon.png`;
  const pub=await upload(buf,path);
  fs.writeFileSync(`out/canon-${art}.png`,buf);
  console.log(`  ✅ staged → out/canon-${art}.png  (${pub.slice(-46)})`);
}
console.log("\nготово");
