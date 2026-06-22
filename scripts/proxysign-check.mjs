// Юнит-проверка подписи медиа-прокси (lib/auth/proxySign.ts).
// Запуск: npx tsx scripts/proxysign-check.mjs   (выход !=0 → провал, годится для CI)
// Покрывает: round-trip, подмену пути/подписи, отсутствие sig, реальную просрочку TTL,
// и устойчивость к реордеру/перекодировке параметров (внешний фетчер FAL/Seedance может переписать URL).
import { signProxyUrl, verifyProxySig } from "../lib/auth/proxySign.ts";

let failed = 0;
const parse = (s) => { const u = new URL(s, "https://x.local"); return { params: u.searchParams, pathname: u.pathname }; };
const assert = (cond, msg) => { console.log((cond ? "✅" : "❌") + " " + msg); if (!cond) failed++; };

// 1) round-trip: подписанный URL верифицируется
const signed = signProxyUrl(
  "/api/lab/yandex-img?path=" + encodeURIComponent("/МАША/look 1/1.jpg") + "&key=" + encodeURIComponent("https://disk.yandex.ru/d/AbC?x=1"),
);
{ const { params, pathname } = parse(signed); assert(verifyProxySig(params, pathname) === true, "валидная подпись → true"); }

// 2) подмена пути → подпись не сходится
{ const { params, pathname } = parse(signed.replace("1.jpg", "2.jpg")); assert(verifyProxySig(params, pathname) === false, "подмена файла в пути → false"); }

// 3) подмена sig → false
{ const { params, pathname } = parse(signed.replace(/sig=[^&]+/, "sig=AAAA")); assert(verifyProxySig(params, pathname) === false, "подделанный sig → false"); }

// 4) нет sig (аноним без подписи) → false
{ const { params, pathname } = parse(signed.replace(/&?sig=[^&]+/, "")); assert(verifyProxySig(params, pathname) === false, "отсутствует sig → false"); }

// 5) реордер параметров + перекодировка '+'/'%20' → подпись всё равно сходится
{
  const u = new URL(signed, "https://x.local");
  const reordered = u.pathname + "?sig=" + u.searchParams.get("sig") + "&exp=" + u.searchParams.get("exp") +
    "&key=" + encodeURIComponent(u.searchParams.get("key")) + "&path=" + encodeURIComponent(u.searchParams.get("path"));
  const { params, pathname } = parse(reordered);
  assert(verifyProxySig(params, pathname) === true, "реордер/перекодировка параметров → true");
}

// 6) реальная просрочка TTL: подписываем на 1с, ждём, проверяем → false
{
  const short = signProxyUrl("/api/lab/img-proxy?url=" + encodeURIComponent("https://basket-01.wbbasket.ru/x/1.webp"), 1);
  { const { params, pathname } = parse(short); assert(verifyProxySig(params, pathname) === true, "свежий 1с-токен → true"); }
  await new Promise((r) => setTimeout(r, 1600));
  { const { params, pathname } = parse(short); assert(verifyProxySig(params, pathname) === false, "тот же токен после 1.6с (просрочен) → false"); }
}

if (failed) { console.error(`\n${failed} проверок упало`); process.exit(1); }
console.log("\nвсе проверки пройдены");
