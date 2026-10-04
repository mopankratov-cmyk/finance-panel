import type { AssortmentDirection } from "./constants";

/**
 * Формы моделей каталога по названиям (движок тенденций, этап 2).
 *
 * Каталог собран, но по форме его не посмотреть: признаки по фото есть у
 * десятков находок, у ~3 тысяч моделей каталога — нет. Название почти всегда
 * называет форму («Bomber», «Tote Bag», «Пальто», «Daunenjacke»), и это бесплатно,
 * прозрачно и проверяемо. Это ОДИН источник признака с честной подписью «по
 * названию»: не по фото и не факт состава. Где название формы не называет
 * (у Polène — имена моделей: «Numéro Un», «Cyme») — «не определена», а не догадка.
 *
 * Правила — по порядку, первое совпавшее решает: специальная форма важнее общей
 * («Faux leather crop biker jacket» — косуха, а не просто куртка; «puffer vest» —
 * жилет). Названия на английском, русском и немецком (витрина Zalando — немецкая).
 * Без \b для кириллицы и немецких составных слов («Daunenjacke», «Umhängetasche»):
 * \b их не видит. Латинские слова — с \b, чтобы «vest» не ловился в «investment».
 */

export interface FormRule {
  key: string;
  label: string;
  re: RegExp;
  /** Без уточнения: «куртка» и «сумка» вообще — форма не названа. */
  generic?: boolean;
}

/** Нижний регистр, ё→е, без диакритики («Numéro» → «numero»), один пробел. */
export function normalizeTitle(title: string | null | undefined): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const JACKET_FORMS: readonly FormRule[] = [
  { key: "biker", label: "Косуха / байкерская", re: /косух|perfecto|\bbiker\b|\brocker\b|\bmoto(?:rcycle)?\b|bikerjacke/ },
  { key: "bomber", label: "Бомбер", re: /бомбер|\bbomber\b|bomberjacke|\bvarsity\b|\bcollege\b/ },
  { key: "trench", label: "Тренч / плащ", re: /тренч|плащ(?!ев)|\btrench|trenchcoat/ },
  { key: "parka", label: "Парка", re: /парка|аляск|\bparkas?\b/ },
  { key: "windbreaker", label: "Ветровка / анорак", re: /ветровк|windbreaker|storm ?breaker|штормовк|\banorak|анорак|windjacke|\bshell\b|hardshell|regenjacke|дождевик|raincoat|\brain jacket|waterproof|непромокаем/ },
  { key: "vest", label: "Жилет", re: /жилет|\bvest\b|\bgilet\b|\bweste\b|\bwaistcoat/ },
  { key: "puffer", label: "Пуховик", re: /пуховик|дутик|дутая|дутый|дутые|\bpuffer|\bpuffa|daunen|\bdown\b|doudoune|пухов/ },
  { key: "quilted", label: "Стёганая / утеплённая", re: /стеган|\bquilted|steppjacke|\bpadded|wattiert/ },
  { key: "denim", label: "Джинсовая", re: /джинсов|\bdenim|jeansjacke|\bjean jacket/ },
  { key: "fleece", label: "Флис / тедди", re: /флис|\bfleece|\bteddy|\bsherpa|плюшев/ },
  { key: "fur", label: "Мех / дублёнка", re: /дубленк|шуб[аыу]|шубк|\bshearling|\bfaux fur|\bfur\b|mouton|pelz|kunstfell|эко-?мех|мехов/ },
  { key: "blazer", label: "Жакет / пиджак", re: /блейзер|пиджак|жакет|\bblazer|\bsakko/ },
  { key: "coat", label: "Пальто", re: /пальто|полупальто|\bcoat\b|\bcoats\b|\bmantel|\bovercoat|\bduffle/ },
  { key: "overshirt", label: "Рубашка-куртка", re: /overshirt|shirt jacket|рубашк[аи]-куртк|куртк[аи]-рубашк|hemdjacke/ },
  { key: "cape", label: "Кейп / пончо", re: /\bcape\b|\bponcho|кейп|пончо|накидк/ },
  { key: "jacket", label: "Куртка (форма не названа)", generic: true, re: /куртк|курточк|\bjacket|\bjacke\b|jacke$|\bjacken\b|\bblouson|\bbolero/ },
];

export const BAG_FORMS: readonly FormRule[] = [
  { key: "backpack", label: "Рюкзак", re: /рюкзак|\bbackpack|rucksack|\bdaypack/ },
  { key: "belt_bag", label: "Поясная", re: /бананк|поясн|на пояс|\bbelt bag|\bbum bag|\bfanny|\bwaist bag|gurteltasche|huftasche|\bsling\b/ },
  { key: "clutch", label: "Клатч", re: /клатч|\bclutch|minaudiere|\bpochette|\benvelope|конверт/ },
  { key: "baguette", label: "Багет", re: /багет|\bbaguette/ },
  { key: "hobo", label: "Хобо", re: /\bhobo|хобо/ },
  { key: "bucket", label: "Ведро (bucket)", re: /\bbucket|\bbckt\b|ведро|beuteltasche|\bpotli/ },
  { key: "tote", label: "Тоут / шопер", re: /\btote|тоут|шопп?ер|\bshopper|shopping bag|\bcabas|henkeltasche/ },
  { key: "saddle", label: "Седло", re: /седло|\bsaddle/ },
  { key: "top_handle", label: "С короткими ручками", re: /\btop[- ]handle|\bsatchel|\bboston|\bdoctor|с короткими ручками|\bframe bag|\bbowling|\bbox bag|\bkelly|\btrapeze|трапеци/ },
  { key: "crossbody", label: "Кросс-боди", re: /кросс[- ]?боди|\bcross[- ]?body|\bcrssbdy|umhangetasche|\bmessenger|через плечо|\bcamera bag|\bflap bag/ },
  { key: "shoulder", label: "На плечо", re: /на плечо|schultertasche|\bshoulder bag|\bunderarm/ },
  { key: "duffle", label: "Дорожная / дафл", re: /\bduffle|\bduffel|weekender|reisetasche|дорожн|спортивн.. сумк|\btravel bag/ },
  { key: "pouch", label: "Косметичка / pouch", re: /косметичк|\bwash bag|\bcosmetic|kulturbeutel|\btoiletry|\bmake-?up bag|\bpouch\b/ },
  { key: "basket", label: "Корзина", re: /корзин|\bbasket/ },
  { key: "bag", label: "Сумка (форма не названа)", generic: true, re: /сумк|\bbag\b|\bbags\b|\bbg\b|tasche|\bhandbag|\bpurse|\bbolsos?\b|\bbolsito/ },
];

export function rulesFor(direction: AssortmentDirection): readonly FormRule[] {
  return direction === "bags" ? BAG_FORMS : JACKET_FORMS;
}

/** Форма модели по названию; null — название формы не называет. */
export function formOf(direction: AssortmentDirection, title: string | null | undefined): FormRule | null {
  const text = normalizeTitle(title);
  if (!text) return null;
  return rulesFor(direction).find((rule) => rule.re.test(text)) ?? null;
}

/** Признаки-уточнения из названия — отдельно от формы, у каждого своя доля. */
export interface TitleTraits {
  /** Куртки: укороченная / удлинённая. */
  length: "cropped" | "long" | null;
  /** Куртки: оверсайз / приталенная. */
  fit: "oversized" | "fitted" | null;
  hooded: boolean;
  /** Куртки: кожа или эко-кожа, замша. Сумки: плетёная, рафия, солома. */
  material: "leather" | "suede" | "woven" | null;
  /** Сумки: маленькая / большая. */
  size: "small" | "large" | null;
}

export function traitsOf(direction: AssortmentDirection, title: string | null | undefined): TitleTraits {
  const t = normalizeTitle(title);
  const empty: TitleTraits = { length: null, fit: null, hooded: false, material: null, size: null };
  if (!t) return empty;
  if (direction === "bags") {
    const size = /\bmini\b|\bmicro\b|\bsmall\b|маленьк|мини\b|\bklein/.test(t) ? "small" : /\blarge\b|\bxl\b|\bxxl\b|\bbig\b|\bmaxi\b|больш|\bgross/.test(t) ? "large" : null;
    const material = /\braffia|\bstraw\b|\bwoven\b|\bwicker|плетен|рафи|солом/.test(t) ? "woven" : null;
    return { ...empty, size, material };
  }
  const length = /\bcrop(?:ped)?\b|укорочен|коротк|\bkurz\b|\bshort\b(?! sleeve)/.test(t) ? "cropped" : /\blong(?:line)?\b|удлинен|длинн|\blang\b|\bmaxi\b/.test(t) ? "long" : null;
  const fit = /oversize|оверсайз|\bboxy\b|свободн|\brelaxed\b|\bloose\b/.test(t) ? "oversized" : /\bfitted\b|приталенн|\bslim\b|\bskinny\b/.test(t) ? "fitted" : null;
  const hooded = /\bhood(?:ed)?\b|капюшон|kapuze/.test(t);
  const material = /замш|\bsuede\b|wildleder/.test(t) ? "suede" : /кожан|экокож|\bleather\b|\bleder\b|kunstleder|lederjacke|\bfaux leather\b/.test(t) ? "leather" : null;
  return { ...empty, length, fit, hooded, material };
}

// ---------------------------------------------------------------------------
// Агрегация: форма × источник с нормировкой

export interface FormModel {
  sourceId: string;
  sourceName: string;
  title: string;
}

export interface SourceSlice {
  sourceId: string;
  name: string;
  count: number;
  /** Доля этой формы в каталоге источника, %. */
  pct: number;
}

export interface FormRow {
  key: string;
  label: string;
  generic: boolean;
  models: number;
  /** Доля всего каталога раздела, % (в знаменателе все модели, и не определённые тоже). */
  share: number;
  /**
   * Средняя доля формы по источникам, % — каждый источник с достаточным
   * каталогом весит одинаково. Большой каталог (Zara — 350 моделей) не должен
   * делать форму «сильнее» только потому, что он большой.
   */
  avgSourceShare: number | null;
  sources: number;
  /** Сколько процентов моделей формы приходится на самый крупный по ней источник. */
  topSourceShare: number;
  /** Почти всё у одного источника — это не распространение формы, а ассортимент бренда. */
  concentrated: boolean;
  perSource: SourceSlice[];
}

export interface TraitCount {
  key: string;
  label: string;
  models: number;
  share: number;
}

export interface FormsReport {
  direction: AssortmentDirection;
  models: number;
  /** Моделей, у которых название называет форму (включая «куртка»/«сумка» без уточнения). */
  recognized: number;
  /** Моделей, у которых названа конкретная форма (без общих «куртка»/«сумка»). */
  specific: number;
  coverage: number;
  specificCoverage: number;
  sourcesCount: number;
  /** Источники, у которых каталог достаточен для средней доли (иначе одна модель даёт «100%»). */
  sourcesInAverage: number;
  rows: FormRow[];
  unrecognized: { count: number; samples: string[] };
  traits: TraitCount[];
  perSource: Array<{ sourceId: string; name: string; models: number; specific: number }>;
}

/** Источник с меньшим каталогом в среднюю долю не входит: одна модель из пяти — не «20% формы». */
export const MIN_SOURCE_MODELS = 10;
/** Форма сосредоточена, если у одного источника больше половины и моделей хватает, чтобы судить. */
export const CONCENTRATION_SHARE = 50;
export const CONCENTRATION_MIN_MODELS = 6;
const MAX_UNRECOGNIZED_SAMPLES = 15;

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

const TRAIT_LABELS: Record<string, string> = {
  cropped: "Укороченные", long: "Длинные", oversized: "Оверсайз", fitted: "Приталенные", hooded: "С капюшоном",
  leather: "Кожа / экокожа", suede: "Замша", woven: "Плетёные / рафия / солома", small: "Маленькие / мини", large: "Большие",
};

export function buildFormsReport(direction: AssortmentDirection, models: FormModel[]): FormsReport {
  const total = models.length;
  const bySource = new Map<string, { name: string; models: number; specific: number }>();
  const formCounts = new Map<string, { rule: FormRule; models: number; perSource: Map<string, number> }>();
  const traitCounts = new Map<string, number>();
  const unrecognized: string[] = [];
  let unrecognizedCount = 0;
  let recognized = 0;
  let specific = 0;

  for (const model of models) {
    const source = bySource.get(model.sourceId) ?? { name: model.sourceName, models: 0, specific: 0 };
    source.models += 1;
    bySource.set(model.sourceId, source);
    const rule = formOf(direction, model.title);
    if (!rule) {
      unrecognizedCount += 1;
      if (unrecognized.length < MAX_UNRECOGNIZED_SAMPLES) unrecognized.push(model.title.slice(0, 80));
    } else {
      recognized += 1;
      if (!rule.generic) {
        specific += 1;
        source.specific += 1;
      }
      const row = formCounts.get(rule.key) ?? { rule, models: 0, perSource: new Map<string, number>() };
      row.models += 1;
      row.perSource.set(model.sourceId, (row.perSource.get(model.sourceId) ?? 0) + 1);
      formCounts.set(rule.key, row);
    }
    const traits = traitsOf(direction, model.title);
    for (const value of [traits.length, traits.fit, traits.material, traits.size]) if (value) traitCounts.set(value, (traitCounts.get(value) ?? 0) + 1);
    if (traits.hooded) traitCounts.set("hooded", (traitCounts.get("hooded") ?? 0) + 1);
  }

  const averaged = [...bySource.entries()].filter(([, s]) => s.models >= MIN_SOURCE_MODELS);
  const rows: FormRow[] = [...formCounts.values()].map(({ rule, models: count, perSource }) => {
    const slices: SourceSlice[] = [...perSource.entries()]
      .map(([sourceId, n]) => ({ sourceId, name: bySource.get(sourceId)?.name ?? sourceId, count: n, pct: pct(n, bySource.get(sourceId)?.models ?? 0) }))
      .sort((a, b) => b.count - a.count || a.sourceId.localeCompare(b.sourceId));
    const top = slices[0];
    const topShare = pct(top?.count ?? 0, count);
    const avg = averaged.length
      ? Math.round((averaged.reduce((sum, [id, s]) => sum + (perSource.get(id) ?? 0) / s.models, 0) / averaged.length) * 1000) / 10
      : null;
    return {
      key: rule.key, label: rule.label, generic: Boolean(rule.generic), models: count, share: pct(count, total), avgSourceShare: avg,
      sources: slices.length, topSourceShare: topShare, concentrated: topShare >= CONCENTRATION_SHARE && count >= CONCENTRATION_MIN_MODELS && slices.length >= 1, perSource: slices,
    };
  });
  // Конкретные формы выше общих; внутри — по числу моделей.
  rows.sort((a, b) => Number(a.generic) - Number(b.generic) || b.models - a.models || a.key.localeCompare(b.key));

  const traits: TraitCount[] = [...traitCounts.entries()]
    .map(([key, n]) => ({ key, label: TRAIT_LABELS[key] ?? key, models: n, share: pct(n, total) }))
    .sort((a, b) => b.models - a.models);

  return {
    direction, models: total, recognized, specific,
    coverage: pct(recognized, total), specificCoverage: pct(specific, total),
    sourcesCount: bySource.size, sourcesInAverage: averaged.length,
    rows,
    unrecognized: { count: unrecognizedCount, samples: unrecognized },
    traits,
    perSource: [...bySource.entries()].map(([sourceId, s]) => ({ sourceId, name: s.name, models: s.models, specific: s.specific })).sort((a, b) => b.models - a.models || a.sourceId.localeCompare(b.sourceId)),
  };
}
