// Юнит-тест чистых хелперов рехоста. Запуск: npx tsx lib/factory/rehostImage.test.mts
// Сетевая часть (download+upload) проверена вживую (WB-фото→бакет→fal 2/2). Здесь — детерминированная логика.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://jwjobmdihddytqfgymus.supabase.co";
import { readFileSync } from "node:fs";
import { isOurStorage, extOf, contentTypeOf, rehostPath } from "./rehostImage";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(a === b, `${m} (got ${JSON.stringify(a)})`); }

// ── extOf: расширение из url (без query/hash), jpeg→jpg, неизвестное→.img ──
eq(extOf("https://x/a/1.webp"), ".webp", "webp");
eq(extOf("https://x/a/1.JPG?sign=abc"), ".jpg", "JPG + query → .jpg");
eq(extOf("https://x/a/1.jpeg"), ".jpg", "jpeg → jpg");
eq(extOf("https://x/a/1.png#frag"), ".png", "png + hash");
eq(extOf("https://basket-39.wbbasket.ru/vol/part/id/images/big/1.webp"), ".webp", "реальный WB-url");
eq(extOf("https://x/no-ext"), ".img", "нет расширения → .img");

// ── contentTypeOf ──
eq(contentTypeOf(".webp"), "image/webp", "webp ct");
eq(contentTypeOf(".png"), "image/png", "png ct");
eq(contentTypeOf(".jpg"), "image/jpeg", "jpg ct");
eq(contentTypeOf(".img"), "image/jpeg", "неизвестное → image/jpeg");

// ── rehostPath: детерминирован, в i2v-src/, тот же url → тот же путь, разные → разные ──
const p1 = rehostPath("https://basket-39.wbbasket.ru/vol8982/part898248/898248413/images/big/1.webp");
const p1b = rehostPath("https://basket-39.wbbasket.ru/vol8982/part898248/898248413/images/big/1.webp");
const p2 = rehostPath("https://basket-39.wbbasket.ru/vol8982/part898248/898248413/images/big/2.webp");
ok(p1.startsWith("i2v-src/"), "путь в i2v-src/");
ok(p1.endsWith(".webp"), "путь сохраняет расширение");
eq(p1, p1b, "детерминирован (идемпотентность кэша)");
ok(p1 !== p2, "разные url → разные пути");
ok(/^i2v-src\/[0-9a-f]{40}\.webp$/.test(p1), "формат sha1+ext");

// ── isOurStorage: наш хост vs внешний ──
ok(isOurStorage("https://jwjobmdihddytqfgymus.supabase.co/storage/v1/object/public/factory-media/x.mp4"), "наш Supabase-хост");
ok(!isOurStorage("https://basket-39.wbbasket.ru/x.webp"), "WB-CDN — НЕ наш");
ok(!isOurStorage("не-урл"), "мусор → не наш (без краша)");

// ── Yandex Disk private paths: FAL needs a temporary direct download URL, not a client hint ──
const source = readFileSync("lib/factory/rehostImage.ts", "utf8");
ok(source.includes('u.startsWith("yandex-disk:")'), "rehost detects yandex-disk hints");
ok(source.includes("getYandexDiskDownloadHref"), "rehost resolves Yandex Disk hints to download hrefs for FAL");

console.log(`\nrehostImage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
