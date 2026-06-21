// List Creatify personas with scene/background to pick a fitting actor. Reads keys from .env.local.
import fs from "fs";
for (const f of [".env.local"]) { try { for (const l of fs.readFileSync(f,"utf8").split("\n")) { const m=l.match(/^\s*(CREATIFY_API_ID|CREATIFY_API_KEY)\s*=\s*(.+?)\s*$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,""); } } catch {} }
const H={"X-API-ID":process.env.CREATIFY_API_ID,"X-API-KEY":process.env.CREATIFY_API_KEY};
const q=process.argv[2]||""; // optional keyword
const url=`https://api.creatify.ai/api/personas/?${q?`keyword=${encodeURIComponent(q)}&`:""}`;
const r=await fetch(url,{headers:H});
const j=await r.json();
const arr=Array.isArray(j)?j:(j.results||j.data||[]);
console.log("total:",arr.length);
for(const p of arr.slice(0,40)){
  console.log([p.id, p.creator_name||p.name, p.gender, p.age_range||p.age, p.style, (p.video_scene||"").slice(0,60)].join(" | "));
}
