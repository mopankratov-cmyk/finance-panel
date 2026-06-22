// Юнит-тест авто-привязки ассетов. Запуск: npx tsx lib/factory/assetBind.test.mts
import { classifyAssets, bestImage, pickImage, chooseBinding, type DiskAsset } from "./assetBind";

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

console.log(`\nassetBind: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
