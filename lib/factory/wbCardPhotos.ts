// Опубликованные фото карточек WB по артикулу — из WB-экспорта NORVIA (02.07.2026).
// Ключевое преимущество как источника твина: КАЖДЫЙ URL привязан к точному артикулу и цвету,
// поэтому «какой это товар» больше не угадывается (в отличие от съёмочных папок, где кадры
// вперемешку). Карточки бывают с плашками — их отсеивает vision-скрин, остатки текста снимает
// clean_first, брак ловит identity-сверка. Публичный CDN, без авторизации.

interface WbCardPhotoSource {
  base: string; // .../images/big/  — дальше <n>.webp
  count: number;
}

const WB_CARD_PHOTOS: Record<string, WbCardPhotoSource> = {
  "HT-42-01": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338422/images/big/", count: 28 },
  "HT-42-02": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338429/images/big/", count: 22 },
  "HT-42-04": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338425/images/big/", count: 26 },
  "HT-42-11": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338424/images/big/", count: 26 },
  "HT-42-22": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338428/images/big/", count: 14 },
  "HT-42-32": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338426/images/big/", count: 27 },
  "HT-42-35": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338423/images/big/", count: 25 },
  "HT-42-43": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338427/images/big/", count: 25 },
  "HT-80-01": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338441/images/big/", count: 24 },
  "HT-80-02": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338448/images/big/", count: 19 },
  "HT-80-04": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338444/images/big/", count: 29 },
  "HT-80-11": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338443/images/big/", count: 24 },
  "HT-80-22": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338447/images/big/", count: 30 },
  "HT-80-32": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338445/images/big/", count: 28 },
  "HT-80-35": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338442/images/big/", count: 24 },
  "HT-80-43": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338446/images/big/", count: 16 },
  "HT-83-01": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338395/images/big/", count: 20 },
  "HT-83-02": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338402/images/big/", count: 20 },
  "HT-83-04": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338398/images/big/", count: 21 },
  "HT-83-11": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338397/images/big/", count: 27 },
  "HT-83-22": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338401/images/big/", count: 12 },
  "HT-83-32": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338399/images/big/", count: 24 },
  "HT-83-35": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338396/images/big/", count: 26 },
  "HT-83-43": { base: "https://basket-39.wbbasket.ru/vol8963/part896338/896338400/images/big/", count: 24 },
  "NV-01-02": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558112/images/big/", count: 21 },
  "NV-01-04": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558107/images/big/", count: 19 },
  "NV-01-05": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558108/images/big/", count: 24 },
  "NV-01-35": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558105/images/big/", count: 22 },
  "NV-01-48": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558111/images/big/", count: 22 },
  "NV-01-53": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558110/images/big/", count: 21 },
  "NV-01-55": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558109/images/big/", count: 20 },
  "NV-01-57": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558104/images/big/", count: 22 },
  "NV-01-58": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558106/images/big/", count: 18 },
  "NV-08-02": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338654/images/big/", count: 22 },
  "NV-08-04": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338679/images/big/", count: 27 },
  "NV-08-05": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338694/images/big/", count: 27 },
  "NV-08-35": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338627/images/big/", count: 21 },
  "NV-08-48": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338675/images/big/", count: 27 },
  "NV-08-53": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338681/images/big/", count: 29 },
  "NV-08-55": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338680/images/big/", count: 28 },
  "NV-08-57": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338637/images/big/", count: 29 },
  "NV-08-58": { base: "https://basket-35.wbbasket.ru/vol7553/part755338/755338619/images/big/", count: 27 },
  "NV-816-02": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549650/images/big/", count: 27 },
  "NV-816-04": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549645/images/big/", count: 28 },
  "NV-816-05": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549646/images/big/", count: 22 },
  "NV-816-11": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549644/images/big/", count: 26 },
  "NV-816-35": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549643/images/big/", count: 24 },
  "NV-816-48": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549649/images/big/", count: 19 },
  "NV-816-53": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549648/images/big/", count: 26 },
  "NV-816-55": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549647/images/big/", count: 27 },
  "NV-816-57": { base: "https://basket-35.wbbasket.ru/vol7555/part755549/755549642/images/big/", count: 18 },
  "NV-836-02": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558098/images/big/", count: 27 },
  "NV-836-04": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558093/images/big/", count: 29 },
  "NV-836-05": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558094/images/big/", count: 27 },
  "NV-836-11": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558092/images/big/", count: 19 },
  "NV-836-35": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558091/images/big/", count: 21 },
  "NV-836-48": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558097/images/big/", count: 19 },
  "NV-836-53": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558096/images/big/", count: 22 },
  "NV-836-55": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558095/images/big/", count: 29 },
  "NV-836-57": { base: "https://basket-35.wbbasket.ru/vol7555/part755558/755558090/images/big/", count: 23 },
};

// Порядок проб выведен из структуры WB-карточек (сверено глазами по HT-42-01 и NV-08-02):
// начало (#1..~6) — обложка + фиче-слайды с плашками «Весна 2026»/callout-ами (грязные);
// СЕРЕДИНА-КОНЕЦ (#13..) — чистые кадры на модели в полный рост и ghost-packshot (предпоследний);
// самый хвост (#last-1..last) — размерная сетка/уход/отзывы (грязные).
// Поэтому пробуем: сначала середину и позднюю часть (чистые фронты и packshot), потом начало.
function candidateOrder(count: number): number[] {
  const nums = Array.from({ length: count }, (_, i) => i + 1);
  if (count <= 6) return nums;
  const cleanZone = nums.slice(Math.floor(count * 0.4), count - 1); // середина..предпоследний
  const late = nums.slice(count - 1);                                // самый последний (иногда packshot)
  const head = nums.slice(0, Math.floor(count * 0.4));               // обложка+фичи — последними
  return [...cleanZone, ...late, ...head];
}

// URL фото карточки для артикула, в порядке предпочтения (чистая зона → хвост → обложки).
// limit по умолчанию 14 — достаточно, чтобы пройти всю чистую зону среднего каталога (~22-28 фото).
export function wbCardPhotoUrls(article: string, limit = 14): string[] {
  const clean = String(article || "").trim().toUpperCase();
  const key = Object.keys(WB_CARD_PHOTOS).find((k) => k.toUpperCase() === clean);
  const source = key ? WB_CARD_PHOTOS[key] : null;
  if (!source || !source.count) return [];
  return candidateOrder(source.count).slice(0, limit).map((n) => `${source.base}${n}.webp`);
}

export function hasWbCardPhotos(article: string): boolean {
  return wbCardPhotoUrls(article, 1).length > 0;
}
