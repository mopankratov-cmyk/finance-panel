import type { CompanyCandidate, CompanyRisk, FactoryOffer, PriceTier, RiskTypeCount, ShopProps, SupplierFactory } from "./factories1688";
import {
  clusterByKey, clusterOf, entityFromName, FACTORY_PRICE_CAPTION, outsideBagProvinces, regionLabel, riskTypeLabel, tagLabel,
  type EntityKind, type FactoryClusterKey, type FactorySource,
} from "./factoryGuide";

/**
 * «Фабрики сумок (1688)»: карточки фабрик из двух источников (поиск поставщиков и поиск товаров), показатели и флаги. Чистые функции.
 *
 * Общего балла нет и быть не может: каждый показатель — отдельно, со своей меткой источника (Ф — факт 1688, З — заявление продавца,
 * О — наша оценка, Р — реестр КНР, Ч — проверено человеком). Флаги — отдельные чипы, без счётчика. Сортировка — по одному выбранному
 * показателю. «Доли» и «четверти» считаются только внутри одной выдачи: с другими запросами они не сравнимы.
 *
 * Название фабрики выходит наружу только у юрлица (有限公司 и т. п.); у ИП и неясных — псевдоним «Фабрика N» и ссылка (у ИП название
 * магазина бывает именем человека). Цены и минимальная партия — да (решение владельца 07.10, только в разделе фабрик).
 */

export type IndicatorKey =
  | "rank" | "oem" | "manufacture" | "proofing" | "region" | "cluster" | "factoryLevel" | "factoryType" | "recTags" | "satisfied" | "monthBuyers"
  | "shopYears" | "repeatRate" | "customerScale" | "officialPartner" | "invoice" | "inspection" | "qualityRefunds" | "ship24h" | "lateShipCompensate"
  | "payLater" | "ship48h" | "orders30d" | "puhuo" | "breadth" | "brands" | "prices" | "moq"
  | "regStatus" | "regAge" | "regEntity" | "regCapital" | "regRisks";

export type Quartile = 1 | 2 | 3 | 4;

export interface FactoryIndicator {
  key: IndicatorKey;
  label: string;
  source: FactorySource;
  /** Значение словами; «нет данных» — у пустых. */
  text: string;
  /** Число для сортировки (у числовых показателей), иначе null. */
  value: number | null;
  empty: boolean;
  /** Четверть внутри выдачи (1 — нижняя, 4 — верхняя); меньше 4 значений в выдаче — null. */
  quartile?: Quartile | null;
  /** На чём стоит число: «по 3 карточкам». */
  basis?: string | null;
  /** Оговорка: что значит и чего не значит. */
  note?: string | null;
}

export type FlagKey =
  | "young_shop" | "quality_refunds" | "foreign_brands" | "trader_breadth" | "resellers_top" | "no_vat_invoice" | "outside_clusters"
  | "registry_not_active" | "registry_dishonest" | "registry_abnormal" | "registry_young" | "registry_incomplete";

export interface FactoryFlag {
  key: FlagKey;
  level: "red" | "yellow";
  source: FactorySource;
  text: string;
}

export interface FactoryOfferCard {
  offerId: string;
  position: number;
  titleZh: string;
  imageUrl: string | null;
  detailUrl: string;
  categoryId: string | null;
  priceMin: number | null;
  priceMax: number | null;
  priceTiers: PriceTier[];
  moq: number | null;
  unit: string | null;
  orders30d: number | null;
  officialInspection: boolean;
}

export interface FactoryCard {
  /**
   * Ключ фабрики для шорт-листа — один и тот же, откуда бы карточка ни пришла и каким бы запросом ни нашлась: у юрлица — name:<нормализованное
   * название>, у ИП и неясных — ps:<HMAC нормализованного названия продавца> (псевдоним: имя не хранится, а продавец узнаётся в следующих
   * поисках; функцию даёт сервер — FactoryBuildOptions.sellerKey). Ссылка на магазин — отдельно (shopUrl). null — ключа не дали (нет функции
   * псевдонима): такую фабрику в шорт-лист не добавить.
   */
  key: string | null;
  /** Номер карточки в этой выдаче (с 1) — им же назван псевдоним «Фабрика N». */
  n: number;
  /** suppliers — только поиск поставщиков; products — только продавец из выдачи товаров; both — названия совпали. */
  origin: "suppliers" | "products" | "both";
  entity: EntityKind;
  /** Название — только у юрлица. */
  name: string | null;
  displayName: string;
  shopUrl: string | null;
  province: string | null;
  city: string | null;
  region: string | null;
  cluster: FactoryClusterKey | null;
  /** № в выдаче поиска поставщиков и лучшая позиция карточек продавца в выдаче товаров — релевантность, не качество. */
  supplierRank: number | null;
  productRank: number | null;
  indicators: FactoryIndicator[];
  flags: FactoryFlag[];
  prices: { min: number; max: number; offers: number; tiers: PriceTier[]; caption: string } | null;
  moq: { min: number; max: number; offers: number; unit: string | null } | null;
  offers: FactoryOfferCard[];
}

export interface FactoryResult {
  /** «Фабрики (поиск поставщиков)» — с товарами продавца, если названия совпали. */
  factories: FactoryCard[];
  /** «Продавцы из выдачи товаров» — названия не совпали ни с одной фабрикой поиска поставщиков. */
  sellers: FactoryCard[];
}

// ---------------------------------------------------------------------------
// Числа и слова

const nf = (digits = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
export const fmtNum = (n: number, digits = 0) => nf(digits).format(n);
const pct = (share: number, digits = 0) => `${fmtNum(share * 100, digits)}%`;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const years = (n: number) => `${fmtNum(n)} ${plural(n, "год", "года", "лет")}`;
const cards = (n: number) => `${fmtNum(n)} ${plural(n, "карточке", "карточкам", "карточкам")}`;
const NO_DATA = "нет данных";

/** Нормализация названия для сведения источников: NFKC (полноширинные скобки и цифры), без пробелов и разметки, латиница — строчными. */
export function normalizeCompanyName(name: string | null | undefined): string {
  return String(name ?? "").replace(/<[^>]*>/g, "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/**
 * Четверть значения внутри выдачи: доля значений СТРОГО меньше его — <25% → 1, <50% → 2, <75% → 3, иначе 4. Равные значения попадают в
 * нижнюю из возможных четвертей (осторожно для флагов «верхняя четверть»). Меньше `min` значений (по умолчанию 4) — null: четверти не из
 * чего считать.
 */
export function quartileOf(value: number | null | undefined, values: readonly number[], min = 4): Quartile | null {
  if (value == null || !Number.isFinite(value)) return null;
  const list = values.filter((v) => Number.isFinite(v));
  if (list.length < Math.max(4, min)) return null;
  const below = list.filter((v) => v < value).length / list.length;
  return below < 0.25 ? 1 : below < 0.5 ? 2 : below < 0.75 ? 3 : 4;
}

const QUARTILE_WORDS: Record<Quartile, string> = { 1: "нижняя четверть выдачи", 2: "2-я четверть выдачи", 3: "3-я четверть выдачи", 4: "верхняя четверть выдачи" };

// ---------------------------------------------------------------------------
// Наши оценки по названиям карточек

const LATIN_BRANDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["MLB", /(?<![A-Za-z])mlb(?![A-Za-z])/i],
  ["Zara", /(?<![A-Za-z])zara(?![A-Za-z])/i],
  ["ZA (Zara)", /(?<![A-Za-z])ZA(?![A-Za-z])/],
  ["Coach", /(?<![A-Za-z])coach(?![A-Za-z])/i],
  ["Gucci", /(?<![A-Za-z])gucci(?![A-Za-z])/i],
  ["Prada", /(?<![A-Za-z])prada(?![A-Za-z])/i],
  ["Chanel", /(?<![A-Za-z])chanel(?![A-Za-z])/i],
  ["Dior", /(?<![A-Za-z])dior(?![A-Za-z])/i],
  ["Hermès", /(?<![A-Za-z])herm[eè]s(?![A-Za-z])/i],
  ["Celine", /(?<![A-Za-z])celine(?![A-Za-z])/i],
  ["Loewe", /(?<![A-Za-z])loewe(?![A-Za-z])/i],
  ["Fendi", /(?<![A-Za-z])fendi(?![A-Za-z])/i],
  ["Balenciaga", /(?<![A-Za-z])balenciaga(?![A-Za-z])/i],
  ["Bottega Veneta", /(?<![A-Za-z])bottega(?![A-Za-z])/i],
  ["YSL", /(?<![A-Za-z])(?:ysl|saint\s*laurent)(?![A-Za-z])/i],
  ["Miu Miu", /(?<![A-Za-z])miu\s*miu(?![A-Za-z])/i],
  ["Louis Vuitton", /(?<![A-Za-z])(?:louis\s*vuitton|LV)(?![A-Za-z])/i],
  ["Michael Kors", /(?<![A-Za-z])michael\s*kors(?![A-Za-z])/i],
  ["Kate Spade", /(?<![A-Za-z])kate\s*spade(?![A-Za-z])/i],
  ["Longchamp", /(?<![A-Za-z])longchamp(?![A-Za-z])/i],
  ["Tory Burch", /(?<![A-Za-z])tory\s*burch(?![A-Za-z])/i],
  ["Furla", /(?<![A-Za-z])furla(?![A-Za-z])/i],
  ["Guess", /(?<![A-Za-z])guess(?![A-Za-z])/i],
  ["Charles & Keith", /(?<![A-Za-z])charles\s*&\s*keith(?![A-Za-z])/i],
  ["Polène", /(?<![A-Za-z])pol[eè]ne(?![A-Za-z])/i],
  ["Jacquemus", /(?<![A-Za-z])jacquemus(?![A-Za-z])/i],
  ["Goyard", /(?<![A-Za-z])goyard(?![A-Za-z])/i],
  ["Burberry", /(?<![A-Za-z])burberry(?![A-Za-z])/i],
  ["Versace", /(?<![A-Za-z])versace(?![A-Za-z])/i],
  ["Givenchy", /(?<![A-Za-z])givenchy(?![A-Za-z])/i],
  ["Valentino", /(?<![A-Za-z])valentino(?![A-Za-z])/i],
  ["Marc Jacobs", /(?<![A-Za-z])marc\s*jacobs(?![A-Za-z])/i],
  ["Uniqlo", /(?<![A-Za-z])uniqlo(?![A-Za-z])/i],
];

const CJK_BRANDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Chanel", /香奈儿/], ["Gucci", /古驰/], ["Prada", /普拉达/], ["Dior", /迪奥/], ["Hermès", /爱马仕/], ["Louis Vuitton", /路易威登/], ["Coach", /蔻驰/],
  ["Balenciaga", /巴黎世家/], ["Fendi", /芬迪/], ["Celine", /赛琳/], ["Loewe", /罗意威/], ["Bottega Veneta", /葆蝶家/], ["Miu Miu", /缪缪/], ["YSL", /圣罗兰/],
  ["Versace", /范思哲/], ["Burberry", /博柏利/], ["Givenchy", /纪梵希/], ["Valentino", /华伦天奴/], ["Uniqlo", /优衣库/], ["Longchamp", /珑骧/],
  ["Michael Kors", /迈克高仕/], ["Kate Spade", /凯特丝蓓/], ["Tory Burch", /汤丽柏琦/],
];

/** Чужие бренды в названии (по границам слов у латиницы). Возможны ложные срабатывания («ZA风» — «в стиле Zara»): это оценка. */
export function brandMentions(title: string): string[] {
  const out: string[] = [];
  for (const [label, re] of [...LATIN_BRANDS, ...CJK_BRANDS]) if (re.test(title) && !out.includes(label)) out.push(label);
  return out;
}

/** Слова с «包 / 袋», которые не про сумки: бесплатная доставка, упаковка, хлеб, юбка-карандаш, карман и т. п. */
const NOT_BAG_WORDS = /包邮|包装|包括|包含|面包|包子|红包|包裹|包臀|包头|口袋|袋鼠/g;

const CATEGORY_GROUPS: ReadonlyArray<readonly [string, RegExp]> = [
  ["сумки", /包|袋|箱/],
  ["обувь", /鞋|靴/],
  ["чехлы и электроника", /手机壳|手机套|保护套|数据线|充电|耳机/],
  ["украшения", /项链|耳环|耳钉|手链|戒指|饰品|发夹|发圈|头饰|胸针/],
  ["шапки, шарфы, перчатки", /帽|围巾|手套|袜/],
  ["одежда", /衣|裤|裙|外套|夹克|衫|羽绒|大衣|风衣|西装|马甲/],
  ["дом", /杯|毛巾|床|枕|收纳盒|地毯|窗帘|餐具/],
];

/** Группа товара по названию (первая подходящая); незнакомое — null (в счёт широты не идёт: оценка снизу). */
export function categoryGroup(title: string): string | null {
  const t = title.replace(NOT_BAG_WORDS, " ");
  return CATEGORY_GROUPS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** С какого числа несвязанных групп товаров продавец «похож на торговца». */
export const TRADER_GROUPS_MIN = 3;
/** Возвраты по качеству считаются только у карточек с таким числом заказов за 30 дней. */
export const QUALITY_MIN_ORDERS = 30;
export const QUALITY_RED_PCT = 3;
export const YOUNG_SHOP_YEARS = 2;
/**
 * «Много перепродавцов» (铺货): четверть считается, только если значение есть хотя бы у стольких продавцов выдачи (на 4–7 продавцах
 * «верхняя четверть» — это один-два магазина), а флаг ставится только от стольких размещений за 30 дней (1 размещение — не «много»).
 * На малой выборке — число без четверти и без чипа.
 */
export const RESELLERS_MIN_SELLERS = 8;
export const RESELLERS_MIN_PUHUO = 20;

// ---------------------------------------------------------------------------
// Сведение источников и карточки

interface Draft {
  supplier: SupplierFactory | null;
  name: string;
  offers: FactoryOffer[];
}

/** Карточки товаров по продавцу (порядок — по первой позиции). Без продавца карточка ни к кому не относится и в фабрики не идёт. */
export function groupOffersBySeller(offers: readonly FactoryOffer[]): Array<{ name: string; norm: string; offers: FactoryOffer[] }> {
  const groups = new Map<string, { name: string; norm: string; offers: FactoryOffer[] }>();
  for (const offer of [...offers].sort((a, b) => a.position - b.position)) {
    const norm = normalizeCompanyName(offer.seller);
    if (!norm) continue;
    const group = groups.get(norm) ?? { name: offer.seller as string, norm, offers: [] };
    group.offers.push(offer);
    groups.set(norm, group);
  }
  return [...groups.values()];
}

interface ResultStats {
  repeat: number[];
  puhuo: number[];
  scale: number[];
}

const shopOf = (offers: readonly FactoryOffer[]): ShopProps | null => offers.find((o) => o.shop)?.shop ?? null;
const puhuoMax = (offers: readonly FactoryOffer[]): number | null => {
  const values = offers.map((o) => o.puhuo30d).filter((v): v is number => v != null);
  return values.length ? Math.max(...values) : null;
};

export interface FactoryBuildOptions {
  /**
   * Псевдоним продавца-ИП (и неясного) для ключа шорт-листа: нормализованное название → «ps:<hex>». Это HMAC с секретом сервера
   * (factorySearch.factorySellerKey), поэтому модуль экрана его не считает (без node:crypto). Нет функции — у ИП и неясных ключа нет.
   */
  sellerKey?: ((normalizedName: string) => string | null) | null;
}

/**
 * Две выдачи → карточки. Поиск поставщиков даёт фабрики по своему порядку; продавцы из выдачи товаров с тем же нормализованным названием
 * присоединяются к ним (одна карточка), остальные — отдельным блоком «Продавцы из выдачи товаров» по лучшей позиции. Четверти — по всем
 * карточкам этой выдачи.
 */
export function buildFactoryResult(suppliers: readonly SupplierFactory[], offers: readonly FactoryOffer[], options: FactoryBuildOptions = {}): FactoryResult {
  const groups = groupOffersBySeller(offers);
  const byNorm = new Map(groups.map((g) => [g.norm, g]));
  const used = new Set<string>();
  const factoryDrafts: Draft[] = suppliers.map((s) => {
    const group = byNorm.get(normalizeCompanyName(s.companyName));
    if (group) used.add(group.norm);
    return { supplier: s, name: s.companyName, offers: group?.offers ?? [] };
  });
  const sellerDrafts: Draft[] = groups.filter((g) => !used.has(g.norm)).map((g) => ({ supplier: null, name: g.name, offers: g.offers }));
  const all = [...factoryDrafts, ...sellerDrafts];
  const stats: ResultStats = { repeat: [], puhuo: [], scale: [] };
  for (const d of all) {
    const shop = shopOf(d.offers);
    if (shop?.repeatRate != null) stats.repeat.push(shop.repeatRate);
    if (shop?.customerScale != null) stats.scale.push(shop.customerScale);
    const p = puhuoMax(d.offers);
    if (p != null) stats.puhuo.push(p);
  }
  const built = all.map((d, i) => buildCard(d, i + 1, stats, options.sellerKey ?? null));
  return { factories: built.slice(0, factoryDrafts.length), sellers: built.slice(factoryDrafts.length) };
}

/**
 * Ключ фабрики не зависит от источника и запроса: юрлицо — по нормализованному названию, ИП и неясные — псевдоним по нормализованному
 * названию продавца (HMAC, имя не хранится). Тот же продавец из другого поиска (другие карточки, поиск поставщиков вместо выдачи товаров)
 * попадает в ту же запись шорт-листа.
 */
export function factoryKeyOf(name: string, entity: EntityKind, sellerKey: FactoryBuildOptions["sellerKey"] = null): string | null {
  const norm = normalizeCompanyName(name);
  if (!norm) return null;
  if (entity === "company") return `name:${norm}`.slice(0, 400);
  const key = sellerKey?.(norm) ?? null;
  return key && /^ps:[0-9a-f]{32,128}$/.test(key) ? key : null;
}

const ind = (key: IndicatorKey, label: string, source: FactorySource, text: string | null, value: number | null = null, extra: Partial<FactoryIndicator> = {}): FactoryIndicator => ({
  key, label, source, text: text ?? NO_DATA, value: text == null ? null : value, empty: text == null, ...extra,
});

function buildCard(d: Draft, n: number, stats: ResultStats, sellerKey: FactoryBuildOptions["sellerKey"]): FactoryCard {
  const s = d.supplier;
  const entity = entityFromName(d.name);
  const offers = [...d.offers].sort((a, b) => a.position - b.position);
  const shop = shopOf(offers);
  const province = s?.province ?? null;
  const city = s?.city ?? null;
  const cluster = clusterOf({ province, city, hint: entity === "company" ? d.name : null });
  const indicators: FactoryIndicator[] = [];
  const flags: FactoryFlag[] = [];
  const total = offers.length;
  const productRank = total ? offers[0].position : null;

  // № в выдаче — релевантность, а не качество
  const rankParts = [s ? `поиск поставщиков: №${s.rank}` : null, productRank != null ? `товары: №${productRank}` : null].filter(Boolean);
  indicators.push(ind("rank", "№ в выдаче 1688", "Ф", rankParts.join("; "), s ? s.rank : 1000 + (productRank ?? 999), { note: "релевантность запросу у 1688, а не качество фабрики" }));

  // Заявления продавца (только поиск поставщиков)
  indicators.push(ind("oem", "Модель работы (OEM / ODM)", "З", s?.oemModes.length ? s.oemModes.map(tagLabel).join("; ") : null, null, { note: s ? null : "есть только в поиске поставщиков" }));
  indicators.push(ind("manufacture", "Тип производства", "З", s?.manufactureTypes.length ? s.manufactureTypes.map(tagLabel).join("; ") : null));
  indicators.push(ind("proofing", "Делает образцы (打样)", "З", s?.proofing ? "да" : null, null, { note: "отсутствие отметки не значит «нет»; срок и цену образца выясняет человек" }));

  // Регион и кластер
  const region = regionLabel(province, city);
  indicators.push(ind("region", "Регион регистрации", "Ф", region));
  const c = clusterByKey(cluster);
  indicators.push(ind("cluster", "Кластер", "О", c ? `${c.ru} — ${c.hint}` : region ? "вне справочника кластеров" : null, null, { note: "по региону регистрации: цех может быть в другом месте" }));
  if (outsideBagProvinces(province)) flags.push({ key: "outside_clusters", level: "yellow", source: "О", text: "регистрация вне кластеров сумок — спросить, где цех" });

  // Метки 1688 (значения не расшифрованы)
  indicators.push(ind("factoryLevel", "Уровень фабрики", "Ф", s?.factoryLevel ? tagLabel(s.factoryLevel) : null, null, { note: "метка 1688, значение не расшифровано" }));
  indicators.push(ind("factoryType", "Тип фабрики", "Ф", s?.factoryTypeTags.length ? s.factoryTypeTags.map(tagLabel).join("; ") : null, null, { note: "метка 1688" }));
  indicators.push(ind("recTags", "Метки 1688", "Ф", s?.recTags.length ? s.recTags.map(tagLabel).join("; ") : null));
  indicators.push(ind("satisfied", "Удовлетворённость покупателей", "Ф", s?.satisfiedText ?? null, s?.satisfiedPct ?? null, { note: "формула 1688 неизвестна" }));
  indicators.push(ind("monthBuyers", "Оборот на 1688 за месяц", "Ф", s?.monthBuyers != null ? fmtNum(s.monthBuyers) : null, s?.monthBuyers ?? null, {
    note: "заказы или покупатели — смысл поля не подтверждён; сравнивать только внутри одного запроса",
  }));

  // Магазин (одинаков у всех карточек продавца)
  const shopYears = shop?.years ?? null;
  indicators.push(ind("shopYears", "Стаж магазина на 1688", "Ф", shopYears != null ? years(shopYears) : null, shopYears, { note: "от 3 лет — норма, от 5 — для основной фабрики" }));
  if (shopYears != null && shopYears < YOUNG_SHOP_YEARS) flags.push({ key: "young_shop", level: "yellow", source: "Ф", text: `молодой магазин: ${years(shopYears)} на 1688` });

  const puhuo = puhuoMax(offers);
  const puhuoQ = quartileOf(puhuo, stats.puhuo, RESELLERS_MIN_SELLERS);
  const repeat = shop?.repeatRate ?? null;
  const repeatQ = quartileOf(repeat, stats.repeat);
  indicators.push(ind("repeatRate", "Доля повторных покупателей (回头率)", "Ф", repeat != null ? `${pct(repeat)}${repeatQ ? ` · ${QUARTILE_WORDS[repeatQ]}` : ""}` : null, repeat, {
    quartile: repeatQ,
    note: repeatQ === 4 && puhuoQ === 4 ? "повторы могут давать перепродавцы (много размещений 铺货)" : "сравнивается внутри выдачи, а не с порогом",
  }));
  const scale = shop?.customerScale ?? null;
  const scaleQ = quartileOf(scale, stats.scale);
  indicators.push(ind("customerScale", "Масштаб клиентской базы", "Ф", scale != null ? `${fmtNum(scale)}${scaleQ ? ` · ${QUARTILE_WORDS[scaleQ]}` : ""}` : null, scale, {
    quartile: scaleQ, note: "определение 1688 не документировано; сравнивать только внутри выдачи",
  }));
  indicators.push(ind("officialPartner", "Официальный партнёр 1688", "Ф", shop?.officialPartner == null ? null : shop.officialPartner ? "да" : "нет"));

  // Карточки продавца в выдаче
  const special = offers.filter((o) => o.invoice === "special").length;
  const ordinary = offers.filter((o) => o.invoice === "ordinary").length;
  indicators.push(ind("invoice", "Счёт: 专票 (с НДС) / 普票 (обычный)", "Ф",
    special ? `专票 — счёт-фактура с НДС (на ${special} из ${total})` : ordinary ? `только 普票 — обычный счёт (на ${ordinary} из ${total})` : null, special ? special / total : null,
    { note: "专票 — плюс, но фабрику не доказывает" }));
  if (special === 0 && ordinary > 0) flags.push({ key: "no_vat_invoice", level: "yellow", source: "Ф", text: "ни у одной карточки нет 专票 (счёта с НДС) — слабый признак" });

  const inspected = offers.filter((o) => o.officialInspection).length;
  indicators.push(ind("inspection", "Официальная приёмка (官方验货)", "Ф", total ? `${inspected} из ${total} карточек` : null, total ? inspected / total : null, {
    basis: total ? `по ${cards(total)} в выдаче` : null, note: "страховка пробной партии, а не свидетельство о фабрике",
  }));

  const eligible = offers.filter((o) => (o.orders30d ?? 0) >= QUALITY_MIN_ORDERS && o.qualityRefundPct != null);
  const worst = eligible.length ? Math.max(...eligible.map((o) => o.qualityRefundPct as number)) : null;
  indicators.push(ind("qualityRefunds", "Возвраты по качеству (品质退款率)", "Ф", worst != null ? `${fmtNum(worst, 1)}%` : null, worst, {
    basis: worst != null ? `по ${cards(eligible.length)} с ≥${QUALITY_MIN_ORDERS} заказами за 30 дней (наибольшее)` : null,
    note: total && worst == null ? `мало заказов: ни у одной карточки нет ${QUALITY_MIN_ORDERS} заказов за 30 дней` : "0% без объёма плюсом не считается",
  }));
  if (worst != null && worst > QUALITY_RED_PCT) flags.push({ key: "quality_refunds", level: "red", source: "Ф", text: `возвраты по качеству ${fmtNum(worst, 1)}% при ≥${QUALITY_MIN_ORDERS} заказах` });

  const ships = offers.map((o) => o.ship24h).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  const shipMedian = ships.length ? ships[Math.floor((ships.length - 1) / 2)] : null;
  indicators.push(ind("ship24h", "Передача курьеру за 24 ч", "Ф", shipMedian != null ? pct(shipMedian) : null, shipMedian, {
    basis: shipMedian != null ? `медиана по ${cards(ships.length)}` : null, note: "0 у 1688 не отличить от «нет данных»; это товар со склада, а не пошив партии",
  }));
  const comp = offers.map((o) => o.lateShipCompensate).filter((v): v is boolean => v != null);
  indicators.push(ind("lateShipCompensate", "Компенсация за задержку отгрузки", "Ф", comp.length ? (comp.some(Boolean) ? "есть" : "нет") : null));
  const later = offers.filter((o) => o.payLater).length;
  indicators.push(ind("payLater", "Оплата через 30 дней (先采后付)", "Ф", later ? `есть (на ${later} из ${total})` : null, null, { note: "отсутствие ничего не значит" }));
  const fast = offers.filter((o) => o.ship48h).length;
  indicators.push(ind("ship48h", "Отгрузка за 48 ч (обещание 1688)", "Ф", fast ? `есть (на ${fast} из ${total})` : null));

  const orderValues = offers.map((o) => o.orders30d).filter((v): v is number => v != null);
  const orders = orderValues.length ? orderValues.reduce((a, b) => a + b, 0) : null;
  indicators.push(ind("orders30d", "Заказы за 30 дней по карточкам в выдаче", "Ф", orders != null ? `не меньше ${fmtNum(orders)}` : null, orders, {
    basis: orders != null ? `по ${cards(orderValues.length)} — нижняя граница` : null,
  }));
  indicators.push(ind("puhuo", "Размещения у перепродавцов за 30 дней (铺货)", "Ф", puhuo != null ? `${fmtNum(puhuo)}${puhuoQ ? ` · ${QUARTILE_WORDS[puhuoQ]}` : ""}` : null, puhuo, {
    quartile: puhuoQ, basis: puhuo != null ? "наибольшее по карточкам продавца" : null,
    note: puhuoQ ? "четверть — наша оценка внутри выдачи" : `четверть — только при ${RESELLERS_MIN_SELLERS}+ продавцах со значением в выдаче`,
  }));
  if (puhuoQ === 4 && puhuo != null && puhuo >= RESELLERS_MIN_PUHUO) {
    flags.push({ key: "resellers_top", level: "yellow", source: "О", text: `много перепродавцов: ${fmtNum(puhuo)} размещений 铺货 за 30 дней — верхняя четверть выдачи` });
  }

  // Наши расчёты по названиям карточек
  const groups = [...new Set(offers.map((o) => categoryGroup(o.titleZh)).filter((g): g is string => Boolean(g)))];
  const cats = new Set(offers.map((o) => o.categoryId).filter(Boolean)).size;
  indicators.push(ind("breadth", "Широта ассортимента в выдаче", "О", total ? `${groups.length ? groups.join(", ") : "группы не распознаны"}; категорий 1688: ${cats}` : null, total ? groups.length : null, {
    basis: total ? `по ${cards(total)} — нижняя граница` : null,
  }));
  if (groups.length >= TRADER_GROUPS_MIN) flags.push({ key: "trader_breadth", level: "yellow", source: "О", text: `${groups.length} несвязанных групп товаров — похоже на торговца` });

  const withBrands = offers.map((o) => brandMentions(o.titleZh));
  const brandOffers = withBrands.filter((b) => b.length > 0).length;
  const brandNames = [...new Set(withBrands.flat())];
  indicators.push(ind("brands", "Чужие бренды в названиях", "О", total ? (brandOffers ? `${brandOffers} из ${total} карточек: ${brandNames.join(", ")}` : "не найдено") : null, total ? brandOffers / total : null, {
    note: "риск блокировки карточек WB, не доказательство подделки; возможны ложные срабатывания",
  }));
  if (brandOffers > 0) flags.push({ key: "foreign_brands", level: "red", source: "О", text: `чужие бренды в названиях (${brandNames.join(", ")}) — риск ИС на WB` });

  // Цены и минимальная партия (решение владельца 07.10)
  const priced = offers.filter((o) => o.priceMin != null);
  const prices = priced.length
    ? {
      min: Math.min(...priced.map((o) => o.priceMin as number)),
      max: Math.max(...priced.map((o) => (o.priceMax ?? o.priceMin) as number)),
      offers: priced.length,
      tiers: offers.find((o) => o.priceTiers.length > 0)?.priceTiers ?? [],
      caption: FACTORY_PRICE_CAPTION,
    }
    : null;
  indicators.push(ind("prices", "Цены карточек (¥ за шт.)", "Ф", prices ? `¥${fmtNum(prices.min, 2)}${prices.max > prices.min ? `–${fmtNum(prices.max, 2)}` : ""}` : null, prices?.min ?? null, {
    basis: prices ? `по ${cards(prices.offers)}` : null, note: FACTORY_PRICE_CAPTION,
  }));
  const moqs = offers.map((o) => o.moq).filter((v): v is number => v != null);
  const unit = offers.find((o) => o.unit)?.unit ?? null;
  const moq = moqs.length ? { min: Math.min(...moqs), max: Math.max(...moqs), offers: moqs.length, unit } : null;
  indicators.push(ind("moq", "Минимальная партия", "Ф", moq ? (moq.max > moq.min ? `${fmtNum(moq.min)}–${fmtNum(moq.max)} шт.` : `от ${fmtNum(moq.min)} шт.`) : null, moq?.min ?? null, {
    basis: moq ? `по ${cards(moq.offers)}` : null,
    note: moq && moq.max <= 1 ? "партия от 1 шт. — розничный пул 1688; партию под заказ уточнять в переписке" : "партия карточки 1688, а не под ваше ТЗ",
  }));

  return {
    key: factoryKeyOf(d.name, entity, sellerKey),
    n,
    origin: s && offers.length ? "both" : s ? "suppliers" : "products",
    entity,
    name: entity === "company" ? d.name : null,
    displayName: entity === "company" ? d.name : `Фабрика ${n}`,
    shopUrl: s?.companyUrl ?? null,
    province,
    city,
    region,
    cluster,
    supplierRank: s?.rank ?? null,
    productRank,
    indicators,
    flags,
    prices,
    moq,
    offers: offers.map((o) => ({
      offerId: o.offerId, position: o.position, titleZh: o.titleZh, imageUrl: o.imageUrl, detailUrl: o.detailUrl, categoryId: o.categoryId, priceMin: o.priceMin,
      priceMax: o.priceMax, priceTiers: o.priceTiers, moq: o.moq, unit: o.unit, orders30d: o.orders30d, officialInspection: o.officialInspection,
    })),
  };
}

// ---------------------------------------------------------------------------
// Сортировка по одному показателю

export const FACTORY_SORTS = {
  rank: { label: "№ в выдаче 1688 (релевантность, не качество)", dir: "asc" },
  shopYears: { label: "Стаж магазина", dir: "desc" },
  repeatRate: { label: "Доля повторных покупателей", dir: "desc" },
  customerScale: { label: "Масштаб клиентской базы", dir: "desc" },
  satisfied: { label: "Удовлетворённость покупателей", dir: "desc" },
  monthBuyers: { label: "Оборот за месяц", dir: "desc" },
  orders30d: { label: "Заказы за 30 дней", dir: "desc" },
  inspection: { label: "Доля карточек с официальной приёмкой", dir: "desc" },
  prices: { label: "Цена карточек (от дешёвых)", dir: "asc" },
  moq: { label: "Минимальная партия (от меньшей)", dir: "asc" },
} as const satisfies Partial<Record<IndicatorKey, { label: string; dir: "asc" | "desc" }>>;

export type FactorySortKey = keyof typeof FACTORY_SORTS;

export function parseSortKey(value: unknown): FactorySortKey {
  return typeof value === "string" && value in FACTORY_SORTS ? (value as FactorySortKey) : "rank";
}

/** Сортировка по ОДНОМУ показателю: «нет данных» — в конце, при равенстве — порядок выдачи 1688. Сортировки по числу флагов нет. */
export function sortFactoryCards(list: readonly FactoryCard[], key: FactorySortKey): FactoryCard[] {
  const dir = FACTORY_SORTS[key].dir === "asc" ? 1 : -1;
  const valueOf = (card: FactoryCard) => card.indicators.find((i) => i.key === key)?.value ?? null;
  const rankOf = (card: FactoryCard) => card.indicators.find((i) => i.key === "rank")?.value ?? Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va == null && vb == null) return rankOf(a) - rankOf(b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || rankOf(a) - rankOf(b);
  });
}

// ---------------------------------------------------------------------------
// Реестр (88查)

export interface RegistryFacts {
  checkedOn: string;
  entity: EntityKind;
  status: string | null;
  active: boolean | null;
  establishedOn: string | null;
  ageYears: number | null;
  entType: string | null;
  regCapText: string | null;
  area: string | null;
  risks: {
    total: number | null;
    fetched: number;
    /** Все ли риски пришли (иначе счёт по типам — нижняя граница). */
    complete: boolean;
    byType: RiskTypeCount[];
    lastOn: string | null;
    dishonest: number;
    abnormalCount: number;
    abnormalLastOn: string | null;
  } | null;
  indicators: FactoryIndicator[];
  flags: FactoryFlag[];
}

const DAY_MS = 24 * 3600 * 1000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Полных лет между датами (ГГГГ-ММ-ДД). */
export function fullYears(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  let y = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) y -= 1;
  return y >= 0 ? y : null;
}

/** Факты реестра без показателей — как их хранит шорт-лист (StoredRegistry) и как их получает экран. */
export type RegistrySummary = Omit<RegistryFacts, "indicators" | "flags">;

/**
 * Показатели реестра (метка Р) по фактам: статус, возраст, юрлицо или ИП, капитал (с пометкой «легко подогнать»), риски по типам и дата
 * последнего. Одна функция и для свежей проверки, и для сохранённой в шорт-листе — слова не расходятся.
 */
export function registryIndicators(r: Pick<RegistrySummary, "entity" | "status" | "active" | "establishedOn" | "ageYears" | "entType" | "regCapText" | "risks">): FactoryIndicator[] {
  const indicators: FactoryIndicator[] = [];
  indicators.push(ind("regStatus", "Статус в реестре", "Р", r.status ? `${r.status}${r.active === true ? " — действует" : r.active === false ? " — не действует" : ""}` : null));
  indicators.push(ind("regAge", "Возраст компании", "Р", r.ageYears != null ? `${years(r.ageYears)} (с ${r.establishedOn})` : null, r.ageYears));
  indicators.push(ind("regEntity", "Юрлицо или ИП", "Р", r.entType ? `${r.entity === "company" ? "юрлицо" : r.entity === "individual" ? "ИП" : "не ясно"} (${r.entType})` : null));
  indicators.push(ind("regCapital", "Уставный капитал", "Р", r.regCapText ?? null, null, { note: "легко подогнать — не опора" }));
  if (r.risks) {
    const risk = r.risks;
    const total = risk.total ?? risk.fetched;
    const parts = risk.byType.map((t) => `${riskTypeLabel(t.subType ?? t.mainType)} — ${t.count}${t.lastOn ? ` (последний ${t.lastOn})` : ""}`);
    indicators.push(ind("regRisks", "Риски (88查)", "Р", total === 0 ? "рисков не найдено" : `${fmtNum(total)}: ${parts.join("; ")}`, total, {
      basis: risk.complete ? null : `по типам — первые ${risk.fetched} из ${risk.total}`,
    }));
  }
  return indicators;
}

/**
 * Факты реестра для карточки: статус, возраст, юрлицо или ИП, капитал (с пометкой «легко подогнать»), риски по типам и дата последнего.
 * Флаги: статус не «действует» и «недобросовестный должник» (失信被执行人) — красные; «нарушения в деятельности» (经营异常) за последний
 * год — красный; компании меньше года — жёлтый. Рисков в реестре больше, чем прочитано, — жёлтый «проверьте вручную»: отсутствие
 * красного флага по неполной странице не значит «должником не числится».
 */
export function registryFacts(candidate: Partial<CompanyCandidate> | null, risk: CompanyRisk | null, today: string): RegistryFacts {
  const status = candidate?.status ?? null;
  const active = candidate?.active ?? null;
  const establishedOn = candidate?.establishedOn ?? null;
  const ageYears = establishedOn ? fullYears(establishedOn, today) : null;
  const entity = candidate?.entity ?? "unknown";
  const flags: FactoryFlag[] = [];
  if (active === false) flags.push({ key: "registry_not_active", level: "red", source: "Р", text: `в реестре не «действует»: ${status}` });
  if (ageYears != null && ageYears < 1) flags.push({ key: "registry_young", level: "yellow", source: "Р", text: "компании меньше года" });
  let risks: RegistryFacts["risks"] = null;
  if (risk) {
    const complete = risk.total == null || risk.fetched >= risk.total;
    risks = {
      total: risk.total, fetched: risk.fetched, complete, byType: risk.byType, lastOn: risk.lastOn, dishonest: risk.dishonest,
      abnormalCount: risk.abnormal.count, abnormalLastOn: risk.abnormal.lastOn,
    };
    if (risk.dishonest > 0) flags.push({ key: "registry_dishonest", level: "red", source: "Р", text: "недобросовестный должник (失信被执行人)" });
    if (risk.abnormal.lastOn && dayMs(today) - dayMs(risk.abnormal.lastOn) <= 365 * DAY_MS) {
      flags.push({ key: "registry_abnormal", level: "red", source: "Р", text: `нарушения в деятельности (经营异常) за последний год: ${risk.abnormal.lastOn}` });
    }
    if (!complete) {
      flags.push({
        key: "registry_incomplete", level: "yellow", source: "Р",
        text: `рисков в реестре больше, чем прочитано (${fmtNum(risk.fetched)} из ${fmtNum(risk.total ?? 0)}): «недобросовестный должник» (失信) и «нарушения» (经营异常) могли не попасть — проверьте вручную`,
      });
    }
  }
  const summary: RegistrySummary = {
    checkedOn: today, entity, status, active, establishedOn, ageYears, entType: candidate?.entType ?? null, regCapText: candidate?.regCapText ?? null,
    area: candidate?.area ?? null, risks,
  };
  return { ...summary, indicators: registryIndicators(summary), flags };
}
