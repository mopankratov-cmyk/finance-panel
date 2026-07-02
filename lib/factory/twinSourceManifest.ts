// Манифест исходников для цифровых твинов — результат визуального аудита съёмки 2026-07-02
// (14 агентов отсмотрели все папки товаров: см. docs/factory-railway-night-log.md).
// Проблема, которую решает манифест: в папках лежат готовые карточки маркетплейса с вшитым
// текстом и вперемешку с AI-рендерами товара; слепые эвристики пикеров брали их исходниками,
// и твины выдумывали детали. Манифест указывает ЧИСТЫЙ кадр переда, проверенный глазами.

export interface TwinSourceManifestEntry {
  article: string;
  disk: string;
  path: string;
  fallbacks?: string[];
  note: string;
  // Нет ни одного чистого кадра — сборка твина запрещена до пополнения съёмки.
  blocked?: boolean;
  // Имена файлов, которые НИКОГДА нельзя брать исходником (AI-рендеры чужого силуэта и т.п.).
  bannedNames?: string[];
}

export const TWIN_SOURCE_MANIFEST: TwinSourceManifestEntry[] = [
  {
    article: "CLR00716",
    disk: "design",
    path: "/МАША/Сумки/Кросс-боди капучино/12.png",
    note: "Единственный чистый перёд анфас без вшитого текста. 8.png (габаритные стрелки) и 13.png (перекрыт айфоном) не брать.",
  },
  {
    article: "CLR00715",
    disk: "design",
    path: "/МАША/Сумки/Кросс-боди шоколад/12 (1).png",
    note: "Чистый перёд, но ВНИМАНИЕ: в папке две фактуры товара (замшевый клапан vs полностью гладкая) — сверить с физическим товаром до публикаций.",
  },
  {
    article: "CLR001101",
    disk: "design",
    path: "/МАША/Сумки/Трапеция черная/2.png",
    note: "Чистого кадра нет; у 2.png текст только в верхних углах — nano-banana чистит. Идеал: запросить исходник 5.png без размерных стрелок.",
  },
  {
    article: "CLR001102",
    disk: "design",
    path: "/МАША/Сумки/Трапеция коричневая/2.png",
    fallbacks: ["/МАША/Сумки/Трапеция коричневая/15.png"],
    note: "Чистого кадра нет; наименее грязные кандидаты (текст в углах, вне товара). Идеал: исходник 6.png без стрелок.",
  },
  {
    article: "TT04101",
    disk: "design",
    path: "/МАША/УЗИ черный/Старая карточка/16.png",
    fallbacks: ["/МАША/УЗИ черный/Старая карточка/15.png"],
    note: "Чистые кадры, но с ИИ-эффектом выстрела — в clean-промпте убирать вспышку/искры у дула.",
  },
  {
    article: "TT04102",
    disk: "design",
    path: "",
    blocked: true,
    note: "0 чистых кадров из 46 — вся папка это карточки с вшитым текстом. Ждём подложки без текстового слоя (NEW светлая/2.png и 8.png существуют у дизайнера).",
  },
  {
    article: "TT05101",
    disk: "design",
    path: "/МАША/Винтовка белая/12.png",
    note: "Единственный чистый кадр из 20.",
  },
  {
    article: "TT05102",
    disk: "design",
    path: "/МАША/Винтовка песочная/12.png",
    note: "Единственный чистый кадр из 19.",
  },
  {
    article: "YYS0101",
    disk: "design",
    path: "/МАША/Крем-молочко YOYO/9.png",
    note: "Лого YOYO в углу вне товара — clean-промпт уберёт. Задней этикетки с составом в съёмке нет вообще.",
  },
  {
    article: "NV-08",
    disk: "norvia",
    path: "/КУЛИСА/темно-зелен/IMG_7073.JPG",
    fallbacks: ["/КУЛИСА/темно-зелен/IMG_7070.JPG"],
    note: "Прямой застёгнутый перёд, товар целиком. Расстёгнутые 7059–7069 не брать (виден свитер). Серии IMG_1778–2130 и IMG_8729–8800 — карточки, запрещены.",
  },
  {
    article: "NV-836",
    disk: "norvia",
    path: "/КОКЕТКА/бежевый/куртка. бежевый.png",
    fallbacks: ["/КОКЕТКА/бежевый/IMG_7466.JPG"],
    note: "Чистый застёгнутый перёд на модели, студийный фон.",
  },
  {
    article: "NV-816",
    disk: "norvia",
    path: "/ПОЯС/ св беж/IMG_7261.JPG",
    fallbacks: ["/ПОЯС/ св беж/IMG_7252.JPG"],
    note: "Перёд в полный рост с поясом — перёд больше не выдумывается со спины. IMG_8493–8496 (инфографика) запрещены.",
    bannedNames: ["IMG_8493.png", "IMG_8494.png", "IMG_8495.png", "IMG_8496.png"],
  },
  {
    article: "NV-01",
    disk: "norvia",
    path: "/ОЛЬГА МАНЖЕТ/бежевый/IMG_7165.JPG",
    fallbacks: ["/ОЛЬГА МАНЖЕТ/бежевый/IMG_7156.JPG", "/ОЛЬГА МАНЖЕТ/бежевый/IMG_1648.jpeg"],
    note: "Реальная студия, застёгнутый перёд, честная длина — лечит твин-варн «длина».",
    // Пакшоты «без модели» с другой длиной/силуэтом — почти наверняка старые AI-рендеры:
    // именно из них прошлый твин выдумал длину и патч.
    bannedNames: ["IMG_1718.jpeg", "IMG_1720.jpeg"],
  },
];

export function twinSourceForArticle(article: string): TwinSourceManifestEntry | null {
  const clean = String(article || "").trim().toUpperCase();
  return TWIN_SOURCE_MANIFEST.find((entry) => entry.article.toUpperCase() === clean) || null;
}

export function isBannedTwinSourceName(article: string, pathOrName: string): boolean {
  const entry = twinSourceForArticle(article);
  if (!entry?.bannedNames?.length) return false;
  const name = String(pathOrName || "").split("/").pop() || "";
  return entry.bannedNames.some((banned) => banned.toLowerCase() === name.toLowerCase());
}
