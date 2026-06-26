// Юнит-тест авто-привязки ассетов. Запуск: npx tsx lib/factory/assetBind.test.mts
import { classifyAssets, bestImage, pickImage, chooseBinding, articleFromAssetUrl, assetMatchesArticle, type DiskAsset } from "./assetBind";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

// ── classifyAssets: реальная съёмка vs WB-фото ──
{
  const assets: DiskAsset[] = [
    { disk: "wb", kind: "image", url: "wb1" },
    { disk: "wb", kind: "image", url: "wb2" },
    { disk: "models", kind: "video", url: "rv1" },   // реальное видео
    { disk: "models", kind: "image", url: "ri1" },   // реальное фото
    { disk: "gen", kind: "image", url: "gen1" },      // сгенерённое — игнор как источник
    { disk: "wb", kind: "image", url: "" },           // пустой url — пропуск
  ];
  const p = classifyAssets(assets);
  eq(p.realVideos, ["rv1"], "realVideos");
  eq(p.realImages, ["ri1"], "realImages (gen не считается real-фото)");
  eq(p.wbImages, ["wb1", "wb2"], "wbImages");
  eq(bestImage(p), "ri1", "bestImage: реальное фото приоритетнее WB");
  eq(bestImage({ realVideos: [], realImages: [], wbImages: ["wb1"] }), "wb1", "bestImage: WB когда нет реального");
}

// ── classifyAssets + pickImage: prepared (source-prep) приоритетнее real и WB ──
{
  const assets: DiskAsset[] = [
    { disk: "wb", kind: "image", url: "wb1" },
    { disk: "models", kind: "image", url: "ri1" },     // реальное фото
    { disk: "prepared", kind: "image", url: "prep1" },  // подготовленный рендер (приоритет)
    { disk: "prepared", kind: "image", url: "prep2" },
  ];
  const p = classifyAssets(assets);
  eq(p.preparedImages, ["prep1", "prep2"], "preparedImages собраны");
  eq(p.realImages, ["ri1"], "real остаётся отдельно");
  eq(bestImage(p), "prep1", "bestImage: prepared важнее real/wb");
  eq(pickImage(p, 0), "prep1", "pickImage idx0 → prepared");
  eq(pickImage(p, 1), "prep2", "pickImage idx1 → второй prepared");
  eq(pickImage(p, 2), "ri1", "pickImage idx2 → real (после prepared)");
  eq(pickImage(p, 3), "wb1", "pickImage idx3 → wb (последним)");
  // i2v-нода без источника берёт prepared
  eq(chooseBinding("seedance", false, p, 0)?.image_url, "prep1", "seedance ← prepared рендер");
}

// ── chooseBinding: disk_real ──
{
  const withVid = { realVideos: ["rv1"], realImages: [], wbImages: ["wb1"] };
  eq(chooseBinding("disk_real", false, withVid), { asset_url: "rv1", reason: "disk_real ← реальное видео товара" }, "disk_real + видео → asset_url");
  const noVid = { realVideos: [], realImages: [], wbImages: ["wb1"] };
  eq(chooseBinding("disk_real", false, noVid)?.tool, "seedance", "disk_real без видео + есть фото → перевод на seedance");
  eq(chooseBinding("disk_real", false, noVid)?.image_url, "wb1", "disk_real→seedance берёт WB-фото");
  eq(chooseBinding("disk_real", false, { realVideos: [], realImages: [], wbImages: [] }), null, "disk_real без видео и без фото → null (нечем)");
}

// ── chooseBinding: i2v ──
{
  const pool = { realVideos: [], realImages: ["ri1"], wbImages: ["wb1"] };
  eq(chooseBinding("seedance", false, pool)?.image_url, "ri1", "seedance без источника → image_url (real фото)");
  eq(chooseBinding("kling", false, pool)?.image_url, "ri1", "kling — то же");
  eq(chooseBinding("seedance", false, { realVideos: [], realImages: [], wbImages: [] }), null, "seedance без фото → null");
}

// ── chooseBinding: не трогаем ноды с источником и не-нашу зону ──
{
  const pool = { realVideos: ["rv1"], realImages: ["ri1"], wbImages: ["wb1"] };
  eq(chooseBinding("seedance", true, pool), null, "нода С источником → null (не вмешиваемся)");
  eq(chooseBinding("creatify", false, pool), null, "creatify → null (не наша забота)");
  eq(chooseBinding("sound", false, pool), null, "sound → null");
}

// ── pickImage: ротация по индексу (real → wb), циклично ──
{
  const p = { realVideos: [], realImages: ["ri1"], wbImages: ["wb1", "wb2"] };
  eq(pickImage(p, 0), "ri1", "idx0 → первое (real)");
  eq(pickImage(p, 1), "wb1", "idx1 → wb1");
  eq(pickImage(p, 2), "wb2", "idx2 → wb2");
  eq(pickImage(p, 3), "ri1", "idx3 → цикл к началу");
  eq(pickImage({ realVideos: [], realImages: [], wbImages: [] }, 0), undefined, "пусто → undefined");
}

// ── chooseBinding с imageIdx: разные i2v-ноды берут разные фото ──
{
  const pool = { realVideos: [], realImages: [], wbImages: ["wb1", "wb2", "wb3"] };
  eq(chooseBinding("seedance", false, pool, 0)?.image_url, "wb1", "i2v idx0 → wb1");
  eq(chooseBinding("seedance", false, pool, 1)?.image_url, "wb2", "i2v idx1 → wb2");
  eq(chooseBinding("disk_real", false, pool, 2)?.image_url, "wb3", "disk_real→seedance idx2 → wb3");
}

// ── ГАРД кросс-контаминации: артикул из URL + сверка с рецептом ──
{
  const B = "https://x.supabase.co/storage/v1/object/public/factory-media";
  eq(articleFromAssetUrl(`${B}/prepared/CLR00912/abc-staged.png`), "CLR00912", "article из prepared-пути");
  eq(articleFromAssetUrl(`${B}/i2v-src/TT06103-orig.png`), "TT06103", "article из i2v-src-пути");
  eq(articleFromAssetUrl(`${B}/clips/deadbeef.mp4`), null, "clip-путь не кодирует article → null");
  eq(articleFromAssetUrl("https://basket-36.wbbasket.ru/vol1/x.webp"), null, "WB-CDN не кодирует article → null");
  eq(articleFromAssetUrl(""), null, "пусто → null");
  // ключевой кейс «пистолет в сумке»: prepared/TT для рецепта CLR → ОТКЛОНИТЬ
  ok(!assetMatchesArticle(`${B}/prepared/TT06103/x-s0.png`, "CLR00912"), "prepared/TT для CLR → отклонён (анти-пистолет-в-сумке)");
  ok(assetMatchesArticle(`${B}/prepared/CLR00912/x-staged.png`, "CLR00912"), "prepared/CLR для своего CLR → принят");
  ok(assetMatchesArticle(`${B}/clips/x.mp4`, "CLR00912"), "clip без article в пути → принят (сверять нечего)");
  ok(assetMatchesArticle("https://basket.wbbasket.ru/x.webp", "CLR00912"), "WB-CDN → принят (article не закодирован)");
  ok(assetMatchesArticle(`${B}/prepared/CLR00912/x.png`, ""), "пустой article рецепта → не блокируем");
}

console.log(`\nassetBind: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
