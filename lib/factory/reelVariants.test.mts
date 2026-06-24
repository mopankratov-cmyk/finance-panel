// Юнит-тест чистых трансформов вариантов. Запуск: npx tsx lib/factory/reelVariants.test.mts
// Без фреймворка (как normalizeParams.test.mts) — простые ассерты, exit 1 при первом провале.
import { selectVisualNodes, cloneNodesWithHook, reorderVisual, patchVariantProps, sanitizeVariant, isPrivateOrLocalUrl } from "./reelVariants";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

const node = (o: any) => ({ ordinal: 0, slot: null, node_type: null, tool: null, prompt: "", params: {}, image_url: null, asset_url: null, duration_sec: null, onscreen_text: null, status: "done", ...o });

// ── selectVisualNodes: только готовый клип с url; не captions/elevenlabs/skip ──
{
  const nodes = [
    node({ tool: "seedance", url: "u1", status: "done" }),                       // ✓
    node({ tool: "seedance", url: undefined, status: "done" }),                  // ✗ нет url
    node({ tool: "seedance", url: "u3", status: "error" }),                      // ✗ не done
    node({ tool: "elevenlabs", url: "u4", status: "done" }),                     // ✗ закадр
    node({ tool: "seedance", url: "u5", status: "done", node_type: "captions" }), // ✗ капшены
    node({ tool: "seedance", url: "u6", status: "done", params: { role: "skip" } }), // ✗ skip
    node({ tool: "creatify", url: "u7", status: "done" }),                       // ✓ актёр — тоже визуал
  ];
  const v = selectVisualNodes(nodes);
  eq(v.map((n) => n.url), ["u1", "u7"], "selectVisualNodes: только годные клипы");
  eq(selectVisualNodes([]), [], "selectVisualNodes: пусто → пусто");
}

// ── cloneNodesWithHook: подмена хука, оригинал НЕ мутирован ──
{
  const orig = [node({ params: { role: "hook" }, onscreen_text: "старый" }), node({ tool: "seedance", url: "u1" })];
  const cl = cloneNodesWithHook(orig, "НОВЫЙ ХУК");
  eq(cl[0].onscreen_text, "НОВЫЙ ХУК", "hook подменён в копии");
  eq(orig[0].onscreen_text, "старый", "оригинал НЕ мутирован");
  ok(cl[0].params !== orig[0].params, "params — новый объект (не та же ссылка)");
  // без хука — копия без изменений текста
  const cl2 = cloneNodesWithHook(orig, undefined);
  eq(cl2[0].onscreen_text, "старый", "без hook → текст не трогаем");
  // нет hook-ноды → берём первую
  const noHook = [node({ tool: "seedance", url: "u1", onscreen_text: "a" })];
  eq(cloneNodesWithHook(noHook, "H")[0].onscreen_text, "H", "нет hook-ноды → хук в первую");
}

// ── reorderVisual: другой первый кадр, хвост сохраняется, дубли/выход за границы игнор ──
{
  const v = [node({ url: "a" }), node({ url: "b" }), node({ url: "c" })];
  eq(reorderVisual(v, [2, 0]).map((n) => n.url), ["c", "a", "b"], "reorder: [2,0] → c,a, хвост b");
  eq(reorderVisual(v, undefined).map((n) => n.url), ["a", "b", "c"], "reorder: нет order → как есть");
  eq(reorderVisual(v, []).map((n) => n.url), ["a", "b", "c"], "reorder: пустой order → как есть");
  eq(reorderVisual(v, [1, 1, 5, -1]).map((n) => n.url), ["b", "a", "c"], "reorder: дубли/out-of-range игнор, хвост добран");
  // не мутирует вход
  reorderVisual(v, [2, 1, 0]);
  eq(v.map((n) => n.url), ["a", "b", "c"], "reorder: вход не мутирован");
}

// ── patchVariantProps: накладывает оси поверх, не трогает прочее, не мутирует вход ──
{
  const base = { durationInFrames: 614, actorEnd: 559, accent: "#ff5a1f" };
  const p = patchVariantProps(base, { accent: "#00f", audioSrc: "music2.mp3", ctaButton: "беги", ctaTitle: "ТИТУЛ" });
  eq(p.accent, "#00f", "accent перекрыт");
  eq(p.audioSrc, "music2.mp3", "audioSrc добавлен");
  eq(p.ctaButton, "беги", "ctaButton добавлен");
  eq(p.ctaTitle, "ТИТУЛ", "ctaTitle добавлен");
  eq(p.durationInFrames, 614, "прочие поля целы");
  eq(base.accent, "#ff5a1f", "вход не мутирован");
  eq(patchVariantProps(base, {}), base, "пустой вариант → пропсы без изменений");
}

// ── cloneNodesWithHook: ГЛУБОКАЯ изоляция вложенных params (ревью-фикс) ──
{
  const orig = [node({ params: { role: "hook", caption_setting: { size: 74 } }, onscreen_text: "h" })];
  const a = cloneNodesWithHook(orig, "A");
  const b = cloneNodesWithHook(orig, "B");
  // мутируем вложенный объект в копии A
  (a[0].params.caption_setting as { size: number }).size = 999;
  eq((orig[0].params.caption_setting as { size: number }).size, 74, "deep-copy: оригинал params.caption_setting не затронут");
  eq((b[0].params.caption_setting as { size: number }).size, 74, "deep-copy: вариант B не отравлен правкой A (изоляция)");
}

// ── sanitizeVariant: клэмп длин/типов, http-only аудио, целые индексы ──
{
  const s = sanitizeVariant({ hook: "  x".padEnd(300, "y"), accent: "#00ff00", ctaTitle: "T".repeat(100), ctaButton: "B".repeat(100), audioSrc: "https://x/track.mp3", overlayOrder: [2, 1.5 as unknown as number, -3, 0, "z" as unknown as number] });
  eq((s.hook as string).length, 200, "hook клэмпнут до 200");
  eq(s.accent, "#00ff00", "accent ок");
  eq((s.ctaTitle as string).length, 60, "ctaTitle клэмпнут до 60");
  eq((s.ctaButton as string).length, 40, "ctaButton клэмпнут до 40");
  eq(s.audioSrc, "https://x/track.mp3", "audioSrc http(s) принят");
  eq(s.overlayOrder, [2, 0], "overlayOrder: только целые ≥0 (1.5/-3/'z' отброшены)");
  // не-http аудио и мусорные типы отбрасываются
  eq(sanitizeVariant({ audioSrc: "reel-assets/m.mp3" }).audioSrc, undefined, "не-http audioSrc отброшен (без staticFile-путей)");
  eq(sanitizeVariant({ hook: 123 as unknown as string }).hook, undefined, "не-строковый hook отброшен");
  eq(sanitizeVariant({ hook: "   " }).hook, undefined, "пустой/пробельный hook отброшен");
  eq(sanitizeVariant(undefined), {}, "undefined вариант → пустой объект");
}

// ── isPrivateOrLocalUrl: SSRF-гард ──
{
  ok(isPrivateOrLocalUrl("http://127.0.0.1/x"), "loopback 127.0.0.1");
  ok(isPrivateOrLocalUrl("http://localhost:8080/x"), "localhost");
  ok(isPrivateOrLocalUrl("https://169.254.169.254/latest/meta-data"), "cloud-metadata 169.254.169.254");
  ok(isPrivateOrLocalUrl("http://10.0.0.5/x"), "private 10.x");
  ok(isPrivateOrLocalUrl("http://192.168.1.1/x"), "private 192.168.x");
  ok(isPrivateOrLocalUrl("http://172.16.0.1/x"), "private 172.16.x");
  ok(isPrivateOrLocalUrl("http://[::1]/x"), "IPv6 loopback");
  ok(isPrivateOrLocalUrl("не-урл"), "мусор → reject (true)");
  ok(!isPrivateOrLocalUrl("https://storage.googleapis.com/bucket/a.mp3"), "публичный CDN — ок");
  ok(!isPrivateOrLocalUrl("https://x.supabase.co/storage/v1/object/public/a.mp3"), "supabase — ок");
  ok(!isPrivateOrLocalUrl("http://172.32.0.1/x"), "172.32 — НЕ приватный (вне 16-31)");
  // sanitizeVariant отсекает приватный audioSrc, пропускает публичный
  eq(sanitizeVariant({ audioSrc: "https://169.254.169.254/x.mp3" }).audioSrc, undefined, "sanitize: metadata-IP audioSrc отброшен");
  eq(sanitizeVariant({ audioSrc: "https://cdn.example.com/x.mp3" }).audioSrc, "https://cdn.example.com/x.mp3", "sanitize: публичный audioSrc принят");
}

console.log(`\nreelVariants: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
