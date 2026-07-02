import { normColor } from "./contentDisks";

// Статический каталог кабинета NORVIA — из WB-экспорта «Общие характеристики» от 02.07.2026.
// Даёт заводу полную карту SKU (модель+цвет→артикул) без зависимости от рантайм-API WB:
// 36 курток (4 модели × 9 цветов) + 24 ветровки (3 модели × 8 цветов).
// Ветровки: съёмка лежит в ZIP (/ОДЕЖДА/Передала Настя Ряго) — контент ещё не разложен.

export interface WbSellerCatalogEntry {
  article: string;
  wbId: number;
  model: string;
  category: "Куртки" | "Ветровки";
  color: string; // цвета карточки через ";", первый — основной
  label: string;
}

export const WB_SELLER_CATALOG: WbSellerCatalogEntry[] = [
  { article: "HT-42-01", wbId: 896338422, model: "HT-42", category: "Ветровки", color: "черный", label: "ветровка кулиса" },
  { article: "HT-42-02", wbId: 896338429, model: "HT-42", category: "Ветровки", color: "светло-бежевый", label: "ветровка кулиса" },
  { article: "HT-42-04", wbId: 896338425, model: "HT-42", category: "Ветровки", color: "светло-зеленый", label: "ветровка кулиса" },
  { article: "HT-42-11", wbId: 896338424, model: "HT-42", category: "Ветровки", color: "серо-бежевый", label: "ветровка кулиса" },
  { article: "HT-42-22", wbId: 896338428, model: "HT-42", category: "Ветровки", color: "темно-серый", label: "ветровка кулиса" },
  { article: "HT-42-32", wbId: 896338426, model: "HT-42", category: "Ветровки", color: "бордовый", label: "ветровка кулиса" },
  { article: "HT-42-35", wbId: 896338423, model: "HT-42", category: "Ветровки", color: "шоколадный", label: "ветровка кулиса" },
  { article: "HT-42-43", wbId: 896338427, model: "HT-42", category: "Ветровки", color: "светло-синий", label: "ветровка кулиса" },
  { article: "HT-80-01", wbId: 896338441, model: "HT-80", category: "Ветровки", color: "черный", label: "ветровка база" },
  { article: "HT-80-02", wbId: 896338448, model: "HT-80", category: "Ветровки", color: "светло-бежевый", label: "ветровка база" },
  { article: "HT-80-04", wbId: 896338444, model: "HT-80", category: "Ветровки", color: "светло-зеленый", label: "ветровка база" },
  { article: "HT-80-11", wbId: 896338443, model: "HT-80", category: "Ветровки", color: "серо-бежевый;серый", label: "ветровка база" },
  { article: "HT-80-22", wbId: 896338447, model: "HT-80", category: "Ветровки", color: "темно-серый", label: "ветровка база" },
  { article: "HT-80-32", wbId: 896338445, model: "HT-80", category: "Ветровки", color: "бордовый", label: "ветровка база" },
  { article: "HT-80-35", wbId: 896338442, model: "HT-80", category: "Ветровки", color: "шоколадный", label: "ветровка база" },
  { article: "HT-80-43", wbId: 896338446, model: "HT-80", category: "Ветровки", color: "светло-синий", label: "ветровка база" },
  { article: "HT-83-01", wbId: 896338395, model: "HT-83", category: "Ветровки", color: "черный", label: "ветровка 83" },
  { article: "HT-83-02", wbId: 896338402, model: "HT-83", category: "Ветровки", color: "светло-бежевый", label: "ветровка 83" },
  { article: "HT-83-04", wbId: 896338398, model: "HT-83", category: "Ветровки", color: "светло-зеленый", label: "ветровка 83" },
  { article: "HT-83-11", wbId: 896338397, model: "HT-83", category: "Ветровки", color: "серо-бежевый", label: "ветровка 83" },
  { article: "HT-83-22", wbId: 896338401, model: "HT-83", category: "Ветровки", color: "темно-серый", label: "ветровка 83" },
  { article: "HT-83-32", wbId: 896338399, model: "HT-83", category: "Ветровки", color: "бордовый", label: "ветровка 83" },
  { article: "HT-83-35", wbId: 896338396, model: "HT-83", category: "Ветровки", color: "шоколадный", label: "ветровка 83" },
  { article: "HT-83-43", wbId: 896338400, model: "HT-83", category: "Ветровки", color: "светло-синий", label: "ветровка 83" },
  { article: "NV-01-02", wbId: 755558112, model: "NV-01", category: "Куртки", color: "светло-бежевый;бежевый;кремово-белый;молочный", label: "пояс-стр-Ольга" },
  { article: "NV-01-04", wbId: 755558107, model: "NV-01", category: "Куртки", color: "светло-зеленый;зеленый;мятный", label: "пояс-стр-Ольга" },
  { article: "NV-01-05", wbId: 755558108, model: "NV-01", category: "Куртки", color: "голубой;светло-голубой;небесно-голубой;небесный", label: "пояс-стр-Ольга" },
  { article: "NV-01-35", wbId: 755558105, model: "NV-01", category: "Куртки", color: "шоколадный;темно-коричневый;шоколадно-коричневый;коричневый", label: "пояс-стр-Ольга" },
  { article: "NV-01-48", wbId: 755558111, model: "NV-01", category: "Куртки", color: "капучино;коричневый;светло-коричневый;глина", label: "пояс-стр-Ольга" },
  { article: "NV-01-53", wbId: 755558110, model: "NV-01", category: "Куртки", color: "темно-синий;синий;океан;синяя волна", label: "пояс-стр-Ольга" },
  { article: "NV-01-55", wbId: 755558109, model: "NV-01", category: "Куртки", color: "бордовый;темно-бордовый;вишня", label: "пояс-стр-Ольга" },
  { article: "NV-01-57", wbId: 755558104, model: "NV-01", category: "Куртки", color: "темно-зеленый;хаки;зеленый", label: "пояс-стр-Ольга" },
  { article: "NV-01-58", wbId: 755558106, model: "NV-01", category: "Куртки", color: "бежевый;темно-бежевый;светло-серый", label: "пояс-стр-Ольга" },
  { article: "NV-08-02", wbId: 755338654, model: "NV-08", category: "Куртки", color: "светло-бежевый;бежевый;кремово-белый;молочный", label: "кулиса 08" },
  { article: "NV-08-04", wbId: 755338679, model: "NV-08", category: "Куртки", color: "светло-зеленый;зеленый;мятный", label: "кулиса 08" },
  { article: "NV-08-05", wbId: 755338694, model: "NV-08", category: "Куртки", color: "голубой;светло-голубой;небесно-голубой;небесный", label: "кулиса 08" },
  { article: "NV-08-35", wbId: 755338627, model: "NV-08", category: "Куртки", color: "шоколадный;коричневый;шоколадно-коричневый;темно-коричневый", label: "кулиса 08" },
  { article: "NV-08-48", wbId: 755338675, model: "NV-08", category: "Куртки", color: "капучино;коричневый;светло-коричневый;глина", label: "кулиса 08" },
  { article: "NV-08-53", wbId: 755338681, model: "NV-08", category: "Куртки", color: "синий;темно-синий;океан;синяя волна", label: "кулиса 08" },
  { article: "NV-08-55", wbId: 755338680, model: "NV-08", category: "Куртки", color: "бордовый;темно-бордовый;вишня", label: "кулиса 08" },
  { article: "NV-08-57", wbId: 755338637, model: "NV-08", category: "Куртки", color: "темно-зеленый;хаки;зеленый", label: "кулиса 08" },
  { article: "NV-08-58", wbId: 755338619, model: "NV-08", category: "Куртки", color: "бежевый;ванильно-бежевый;ванильный;лимонный крем;кремовый", label: "кулиса 08" },
  { article: "NV-816-02", wbId: 755549650, model: "NV-816", category: "Куртки", color: "светло-бежевый;бежевый;кремово-белый;молочный", label: "пояс-стр-816" },
  { article: "NV-816-04", wbId: 755549645, model: "NV-816", category: "Куртки", color: "светло-зеленый;зеленый;мятный", label: "пояс-стр-816" },
  { article: "NV-816-05", wbId: 755549646, model: "NV-816", category: "Куртки", color: "голубой;светло-голубой;небесно-голубой;небесный", label: "пояс-стр-816" },
  { article: "NV-816-11", wbId: 755549644, model: "NV-816", category: "Куртки", color: "бежевый;темно-бежевый;светло-серый", label: "пояс-стр-816" },
  { article: "NV-816-35", wbId: 755549643, model: "NV-816", category: "Куртки", color: "шоколадный;шоколадно-коричневый;темно-коричневый;коричневый", label: "пояс-стр-816" },
  { article: "NV-816-48", wbId: 755549649, model: "NV-816", category: "Куртки", color: "капучино;коричневый;светло-коричневый;глина", label: "пояс-стр-816" },
  { article: "NV-816-53", wbId: 755549648, model: "NV-816", category: "Куртки", color: "темно-синий;синий;океан;синяя волна", label: "пояс-стр-816" },
  { article: "NV-816-55", wbId: 755549647, model: "NV-816", category: "Куртки", color: "бордовый;темно-бордовый;вишня", label: "пояс-стр-816" },
  { article: "NV-816-57", wbId: 755549642, model: "NV-816", category: "Куртки", color: "темно-зеленый;хаки;зеленый", label: "пояс-стр-816" },
  { article: "NV-836-02", wbId: 755558098, model: "NV-836", category: "Куртки", color: "светло-бежевый;бежевый;кремово-белый;молочный", label: "кокетка 836" },
  { article: "NV-836-04", wbId: 755558093, model: "NV-836", category: "Куртки", color: "светло-зеленый;зеленый;мятный", label: "кокетка 836" },
  { article: "NV-836-05", wbId: 755558094, model: "NV-836", category: "Куртки", color: "голубой;небесно-голубой;небесный;светло-голубой", label: "кокетка 836" },
  { article: "NV-836-11", wbId: 755558092, model: "NV-836", category: "Куртки", color: "бежевый;темно-бежевый;светло-серый", label: "кокетка 836" },
  { article: "NV-836-35", wbId: 755558091, model: "NV-836", category: "Куртки", color: "шоколадный;шоколадно-коричневый;коричневый;темно-коричневый", label: "кокетка 836" },
  { article: "NV-836-48", wbId: 755558097, model: "NV-836", category: "Куртки", color: "капучино;коричневый;светло-коричневый;глина", label: "кокетка 836" },
  { article: "NV-836-53", wbId: 755558096, model: "NV-836", category: "Куртки", color: "темно-синий;синий;океан;синяя волна", label: "кокетка 836" },
  { article: "NV-836-55", wbId: 755558095, model: "NV-836", category: "Куртки", color: "бордовый;темно-бордовый;вишня", label: "кокетка 836" },
  { article: "NV-836-57", wbId: 755558090, model: "NV-836", category: "Куртки", color: "темно-зеленый;хаки;зеленый", label: "кокетка 836" },
];

// Съёмочные папки цветов на norvia-шаре — имена ТОЧНЫЕ (включая ведущие пробелы).
const MODEL_ROOT: Record<string, string> = {
  "NV-08": "/КУЛИСА",
  "NV-836": "/КОКЕТКА",
  "NV-816": "/ПОЯС",
  "NV-01": "/ОЛЬГА МАНЖЕТ",
};

const MODEL_COLOR_FOLDERS: Record<string, string[]> = {
  "NV-08": [" голубая", " капучино", " синий", "бежев", "бордо", "масло", "светл-зелен", "темно-зелен", "шоколад"],
  "NV-836": [" темн син", "бежевый", "бордо", "голубой", "капучино", "светл. зеленый", "темн беж", "темн зел", "шоколад"],
  "NV-816": [" св беж", "бордо", "св зел", "синий", "темн беж"],
  "NV-01": [" темн беж", " темн.зел", "бежевый", "бордо", "голубой", "капучино", "манжет синий", "св зелен", "шоколад"],
};

// Пустые папки (цвета «в перекрасе») — контента ещё нет.
const EMPTY_FOLDERS = new Set([
  "/ПОЯС/голубой перекрас",
  "/ПОЯС/капучино перекерас",
  "/ПОЯС/темн зел перекрас",
  "/ПОЯС/шоколад перекрас",
]);

// Легаси-алиасы: существующие твины/вердикты/манифест записаны под короткими артикулами.
export const LEGACY_ARTICLE_BY_SKU: Record<string, string> = {
  "NV-08-57": "NV-08",
  "NV-836-11": "NV-836",
  "NV-816-02": "NV-816",
  "NV-01-58": "NV-01",
};

export function catalogEntryForArticle(article: string): WbSellerCatalogEntry | null {
  const clean = String(article || "").trim().toUpperCase();
  return WB_SELLER_CATALOG.find((entry) => entry.article.toUpperCase() === clean) || null;
}

export function legacyArticleForSku(article: string): string | null {
  return LEGACY_ARTICLE_BY_SKU[String(article || "").trim().toUpperCase()] || null;
}

function colorMatchScore(folderName: string, cardColors: string) {
  const folder = normColor(folderName);
  if (!folder) return 0;
  const tokens = cardColors.split(/[;,]/).map(normColor).filter(Boolean);
  let best = 0;
  tokens.forEach((token, index) => {
    let score = token === folder ? 10 : token.includes(folder) || folder.includes(token) ? 6 : 0;
    if (score && index === 0) score += 2;
    if (score > best) best = score;
  });
  return best;
}

// SKU куртки → папка съёмки его цвета. null = контента нет (ветровки в ZIP,
// «перекрасные» папки ПОЯС пустые) или цвет не сматчился.
export function contentFolderForSku(article: string): { disk: string; prefix: string } | { pending: string } | null {
  const entry = catalogEntryForArticle(article);
  if (!entry) return null;
  if (entry.category === "Ветровки") return { pending: "съёмка в ZIP (/ОДЕЖДА/Передала Настя Ряго) — не распакована" };
  const root = MODEL_ROOT[entry.model];
  const folders = MODEL_COLOR_FOLDERS[entry.model] || [];
  if (!root || !folders.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const folder of folders) {
    const score = colorMatchScore(folder, entry.color);
    if (score > bestScore) { bestScore = score; best = folder; }
  }
  if (!best || bestScore < 6) return null;
  const prefix = `${root}/${best}`;
  if (EMPTY_FOLDERS.has(prefix)) return { pending: "папка цвета пустая (цвет в перекрасе)" };
  return { disk: "norvia", prefix };
}
