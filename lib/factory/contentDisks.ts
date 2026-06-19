// Реестр реального контента на Яндекс.Дисках (съёмки моделей с нашими товарами).
// Завод тянет отсюда настоящие фото/видео и предпочитает их кропу с карточки WB.
// Ключ = публичная ссылка на расшаренную папку.

export interface ContentDisk { id: string; key: string; label: string; cabinetId?: string }

export const CONTENT_DISKS: ContentDisk[] = [
  // cabinetId Retail Family — кабинет курток/ветровок NORVIA (для привязки папок к артикулам по цвету карточки)
  { id: "norvia", key: "https://disk.yandex.ru/d/wrlUYpWVjgWBww", label: "NORVIA — куртки/ветровки (съёмка 15.01.26)", cabinetId: "1f173bb0-e687-4f06-9bb8-a1a44d5621bf" },
  { id: "design", key: "https://disk.yandex.ru/d/12-84kRP_PMbzg", label: "Дизайн — модель МАША (товары в руках)" },
];

// NORVIA: модель-папка съёмки → линия артикула (подтверждено владельцем).
// Точный цвет внутри линии добиваем сопоставлением с текстом цвета карточки (bestArticleByColor).
export const NORVIA_LINE: Record<string, string> = {
  "КУЛИСА": "NV-08",        // куртка база с кулиской
  "КОКЕТКА": "NV-836",      // парка с поясом и кокеткой
  "ПОЯС": "NV-816",         // куртка с поясом и строчкой
  "ОЛЬГА МАНЖЕТ": "NV-01",  // куртка с поясом и строчкой (Ольга/манжет)
};

// Нормализация названия цвета (папка диска ↔ текст цвета карточки). \b в JS не дружит с кириллицей — без него.
export function normColor(s: string): string {
  let x = (s || "").toLowerCase().replace(/ё/g, "е").replace(/[-.,]/g, " ");
  x = x.replace(/перекерас|перекрас|перекр|манжет/g, " ");
  x = x.replace(/темн(?!о)/g, "темно").replace(/светл(?!о)/g, "светло").replace(/(^|\s)св(\s|$)/g, "$1светло$2");
  x = x.replace(/беж\w*/g, "бежев").replace(/зел\w*/g, "зелен").replace(/син\w*/g, "син")
    .replace(/голуб\w*/g, "голуб").replace(/борд\w*/g, "бордов").replace(/шоколад\w*/g, "шоколад");
  return x.replace(/\s+/g, " ").trim();
}

// Подобрать артикул по цвету папки среди кандидатов линии (у каждого — текст цвета карточки).
export function bestArticleByColor(folderColor: string, candidates: { article: string; color: string }[]): string | null {
  const f = normColor(folderColor);
  if (!f) return null;
  let best: string | null = null, bs = 0;
  for (const c of candidates) {
    const toks = c.color.split(",").map(normColor).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let s = t === f ? 10 : (t.includes(f) || f.includes(t)) ? 6 : 0;
      if (s) s += i === 0 ? 2 : 0; // первичный цвет карточки важнее
      if (s > bs) { bs = s; best = c.article; }
    }
  }
  return bs >= 6 ? best : null;
}

// Артикул NORVIA по пути файла съёмки (модель-папка → линия, цвет-папка → точный SKU по карточкам).
export function norviaArticle(path: string, cards: { article: string; color: string }[]): string | null {
  const segs = path.replace(/^\/+/, "").split("/");
  if (segs.length < 2) return null;
  const line = NORVIA_LINE[segs[0].trim()];
  if (!line) return null;
  const cand = cards.filter((c) => c.article.startsWith(line + "-") || c.article.startsWith(line));
  if (!cand.length) return null;
  return bestArticleByColor(segs[1], cand);
}

export function diskById(id: string): ContentDisk | undefined {
  return CONTENT_DISKS.find((d) => d.id === id);
}

// Источник реального контента по ГРУППЕ/товару: каждая запись — где лежит съёмка.
// niche — стабильный id ниши (для каталога/профилей). match — по названию/артикулу товара.
// paths — папки внутри диска (рекурсивно собираем фото).
export interface GroupSource { niche: string; match: RegExp; disk: string; paths: string[]; note: string }

export const GROUP_SOURCES: GroupSource[] = [
  { niche: "jackets", match: /норви|norvia|куртк|ветровк|пухов|\bNV|\bHT/i, disk: "norvia", paths: ["/"], note: "Модель в куртках/ветровках NORVIA, студия" },
  { niche: "bags", match: /сумк|cl[eé]rin|\bbag/i, disk: "design", paths: ["/МАША/Сумки"], note: "Модель с сумками" },
  { niche: "blasters", match: /бластер|во[дs]ный|узи|винтовк|water|пистолет|tim ?tin/i, disk: "design", paths: ["/МАША/Винтовка белая", "/МАША/Винтовка песочная", "/МАША/УЗИ зеленый", "/МАША/УЗИ черный"], note: "Модель с водными бластерами (УЗИ/Винтовка)" },
  { niche: "cream", match: /крем|молочк|yoyo|санскрин|\bspf|солнцезащ/i, disk: "design", paths: ["/МАША/Крем-молочко YOYO"], note: "Модель с кремом YOYO" },
];

// Ниша по пути файла на диске (обратное сопоставление: какой группе принадлежит папка).
export function nicheForPath(diskId: string, path: string): { niche: string; color: string } | null {
  for (const s of GROUP_SOURCES) {
    if (s.disk !== diskId) continue;
    const hit = s.paths.find((p) => p === "/" || path.startsWith(p === "/" ? "/" : p + "/") || path.startsWith(p));
    if (hit) {
      // цвет/вариант = первая значимая подпапка после совпавшего корня
      const rest = path.slice(hit === "/" ? 1 : hit.length).replace(/^\/+/, "");
      const color = rest.includes("/") ? rest.split("/")[0].trim() : "";
      return { niche: s.niche, color };
    }
  }
  return null;
}

export function diskByNiche(niche: string): GroupSource | undefined {
  return GROUP_SOURCES.find((s) => s.niche === niche);
}

// Явная привязка ПАПКА СЪЁМКИ → АРТИКУЛ (по структуре дисков и каталогу товаров).
// Самый длинный совпавший префикс выигрывает. NORVIA-куртки не в текущем кабинете /api/costs → без артикула.
export interface ArticleFolder { disk: string; prefix: string; article: string }
export const ARTICLE_FOLDERS: ArticleFolder[] = [
  // водные бластеры (МАША)
  { disk: "design", prefix: "/МАША/УЗИ черный", article: "TT04101" },        // УЗИ 207мл черный
  { disk: "design", prefix: "/МАША/УЗИ зеленый", article: "TT04102" },       // УЗИ 210мл зеленый
  { disk: "design", prefix: "/МАША/Винтовка белая", article: "TT05101" },    // винтовка M416 белая
  { disk: "design", prefix: "/МАША/Винтовка песочная", article: "TT05102" }, // винтовка M416 беж
  // крем YOYO (МАША)
  { disk: "design", prefix: "/МАША/Крем-молочко YOYO", article: "YYS0101" }, // YoYo SPF50 крем
  // сумки CLÉRIN (МАША/Сумки/<модель цвет>)
  { disk: "design", prefix: "/МАША/Сумки/Кросс-боди капучино", article: "CLR00716" },
  { disk: "design", prefix: "/МАША/Сумки/Кросс-боди шоколад", article: "CLR00715" },
  { disk: "design", prefix: "/МАША/Сумки/Трапеция черная", article: "CLR001101" },
  { disk: "design", prefix: "/МАША/Сумки/Трапеция коричневая", article: "CLR001102" },
];

// Папки-не-товар (служебное) — не индексируем как контент.
export const SKIP_FOLDER = /зеркало|бирк|старая карточк/i;

// Артикул по пути файла (если папка явно сопоставлена товару).
export function articleForPath(diskId: string, path: string): string | null {
  let best: ArticleFolder | null = null;
  for (const a of ARTICLE_FOLDERS) {
    if (a.disk !== diskId) continue;
    if (path === a.prefix || path.startsWith(a.prefix + "/")) {
      if (!best || a.prefix.length > best.prefix.length) best = a;
    }
  }
  return best?.article ?? null;
}

// Файлы-«мусор», которые не годятся как кадр для рендера (лого/обложки/служебные).
export const SKIP_FILE = /бренд|логотип|\blogo|\blого|cover|обложк|\.ds_store|screenshot|\bicon/i;

// Подобрать источник реального контента под товар (имя + артикул).
export function sourceFor(productName: string, article = ""): { disk: ContentDisk; paths: string[]; note: string; niche: string } | null {
  const hay = `${productName} ${article}`;
  for (const s of GROUP_SOURCES) {
    if (s.match.test(hay)) {
      const d = diskById(s.disk);
      if (d) return { disk: d, paths: s.paths, note: s.note, niche: s.niche };
    }
  }
  return null;
}

// Ниша по товару (для подбора визуального профиля).
export function nicheFor(productName: string, article = ""): string | null {
  const hay = `${productName} ${article}`;
  return GROUP_SOURCES.find((s) => s.match.test(hay))?.niche ?? null;
}
