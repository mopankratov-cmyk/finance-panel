// Рехост внешнего изображения в наш публичный Supabase-бакет, чтобы fal (и др. серверные загрузчики)
// надёжно его скачали. КОРЕНЬ: WB-CDN (*.wbbasket.ru) через раз отдаёт серверным загрузчикам fal фейл
// "Failed to download the file" (type: file_download) — submit проходит (200/IN_QUEUE), а на обработке
// часть фото не качается. Проверено вживую: то же фото из нашего бакета проходит fal стабильно (2/2),
// а напрямую с WB — 2/4 падают. Поэтому i2v-источник (фото товара) прогоняем через наш бакет.
//
// Идемпотентно: путь = sha1(url) → одно фото рехостится один раз, дальше переиспользуется (HEAD-чек).
// Best-effort: ЛЮБОЙ сбой (нет ключа/не скачалось/не залилось) → возвращаем исходный url (не ломаем поток —
// fal попробует сам, как раньше). SSRF: приватные/loopback/metadata-хосты НЕ тянем (url мог прийти из данных).
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createHash } from "node:crypto";
import { isPrivateOrLocalUrl } from "./reelVariants";

const BUCKET = "factory-media";
const PREFIX = "i2v-src";

// url уже на нашем сторадже → рехост не нужен (мы и так надёжный источник)
export function isOurStorage(url: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!base) return false;
  try { return new URL(url).host === new URL(base).host; } catch { return false; }
}

// расширение из url (без query); неизвестное → .img (fal определит по content-type)
export function extOf(url: string): string {
  const m = String(url).split(/[?#]/)[0].match(/\.(webp|jpe?g|png|gif)$/i);
  if (!m) return ".img";
  const e = m[1].toLowerCase();
  return "." + (e === "jpeg" ? "jpg" : e);
}
export function contentTypeOf(ext: string): string {
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
}
// детерминированный путь в бакете для данного исходного url
export function rehostPath(url: string): string {
  return `${PREFIX}/${createHash("sha1").update(url).digest("hex")}${extOf(url)}`;
}

export async function rehostImageForFal(url: string | null | undefined): Promise<string> {
  const u = String(url || "").trim();
  if (!u || !/^https?:\/\//i.test(u)) return u;   // пусто/не-http (staticFile и пр.) — как есть
  if (isOurStorage(u)) return u;                  // уже у нас — надёжно
  if (isPrivateOrLocalUrl(u)) return u;           // SSRF-гард: приватное/loopback/metadata не тянем
  const db = getSupabaseAdmin();
  if (!db) { warnFallback(u, "нет supabase-admin (SERVICE_ROLE_KEY?)"); return u; }
  try {
    const path = rehostPath(u);
    const pub = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    // уже рехостили? (идемпотентность — без повторной скачки/заливки)
    try { const head = await fetch(pub, { method: "HEAD", signal: AbortSignal.timeout(8000) }); if (head.ok) return pub; } catch { /* проверим заливкой */ }
    // redirect:"error" — источник на разрешённом хосте мог бы 30x-редиректнуть на приватный IP (169.254.169.254
    // и т.п.) в обход SSRF-гарда (он проверяет только ИСХОДНЫЙ url, не цель редиректа) → fetch бросит, уйдём в фолбэк.
    const r = await fetch(u, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
    if (!r.ok) { warnFallback(u, `download ${r.status}`); return u; } // исходник не скачался у нас — пусть fal попробует сам
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) { warnFallback(u, "пустой буфер"); return u; }
    const ext = extOf(u);
    const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: contentTypeOf(ext), upsert: true, cacheControl: "31536000" });
    if (error) { warnFallback(u, `upload: ${error.message}`); return u; }
    return pub;
  } catch (e) { warnFallback(u, String((e as Error)?.message || e).slice(0, 100)); return u; }
}

// рехост best-effort: при сбое возвращаем ИСХОДНЫЙ url (поток не ломаем). Но молчать нельзя — иначе при
// устойчивом сбое инфры (Supabase/сеть) реген зацикливается на флэйки-WB-url, а оператор видит лишь сырую
// fal-ошибку "file_download" и не понимает, что рехост-контур упал. Лог в Vercel → инцидент инфры ≠ контента.
function warnFallback(url: string, reason: string): void {
  console.warn(`[rehostImageForFal] фолбэк на исходный url (${reason}): ${url.slice(0, 120)}`);
}
