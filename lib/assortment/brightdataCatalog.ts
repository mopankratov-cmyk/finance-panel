/**
 * Сбор новинок через Bright Data: ASOS и H&M — сборщиками 2 раза в неделю, ср
 * и сб (решение владельца 02.10.2026); Zara и Uniqlo — готовыми наборами по
 * средам. Чистые функции: цели сбора, разбор записей, состояние проб.
 *
 * Только готовые сборщики Bright Data; цены вырезаются ещё в stripMoney.
 */

import type { AssortmentDirection } from "./constants";
import { headKind, type CatalogItem } from "./crawl";

/**
 * Часть раздела — отдельная выборка того же набора в тот же раздел (решение
 * владельца 06.10: модели из соцсетей не попадали в каталог). Своя база охвата
 * и свой потолок: часть не вытесняет основную выборку из её 1 000 записей и,
 * появившись, не кладёт базой весь раздел. Записи части проходят ещё и своё
 * правило (keepPartRecord): фильтр набора — по названию на стороне Bright Data
 * (платим за пришедшие записи), правило — окончательное, по названию и описанию.
 */
export type TargetPart = "zara_chaqueta" | "uniqlo_collab";

export const PART_LABEL: Record<TargetPart, string> = {
  zara_chaqueta: "Zara CHAQUETA без трикотажа",
  uniqlo_collab: "коллаборации Uniqlo",
};

/** Название части по коду из журнала прогонов; незнакомый код — как есть. */
export function partLabel(code: string): string {
  return Object.hasOwn(PART_LABEL, code) ? PART_LABEL[code as TargetPart] : code;
}

export interface CollectionTarget {
  sourceId: string;
  datasetId: string;
  direction: AssortmentDirection;
  discoverBy: "keyword" | "category";
  inputs: Array<Record<string, string>>;
  limitPerInput: number;
  method: string;
  /**
   * «dataset» — готовый набор Bright Data (собирают они, мы покупаем выборку
   * по фильтру, $2.5 за 1 000 записей) вместо запуска сборщика.
   */
  kind?: "collect" | "dataset";
  filter?: unknown;
  /**
   * Потолок выборки набора. Раздел обязан влезать целиком: новинка — то, чего
   * не было в прошлых выборках, и обрезанная выборка выдаёт за новинки старые
   * вещи, не попавшие в прошлый раз. Пришло ровно столько, сколько потолок, —
   * раздел считаем обрезанным и новинок из него не показываем.
   */
  recordsLimit?: number;
  /** Запускать только в этот день недели (UTC, 0 — вс): наборы обновляются нечасто. */
  weekdayUtc?: number;
  /** Часть раздела: своя выборка, свой охват, своё правило отбора записей. */
  part?: TargetPart;
}

/**
 * Zara: свой сборщик Bright Data ломается на разборе карточки, а готовый набор
 * «Zara - Products» работает (проба 03.10). Семейства — внутренние коды Zara:
 * CAZADORA — куртки, ABRIGO — пальто, GABARDINA — тренчи, PLUMIFERO —
 * пуховики, BOLSO — сумки. CHAQUETA — отдельной частью (ниже). Одна витрина
 * (США, английский): товар в наборе повторяется по странам, и раздел всех
 * витрин в выборку целиком не влезает. Записи — модель в цвете; набор хранит
 * и распроданное (`availability: false`): куртки одной витрины не влезли в 600
 * записей (03.10) ни с распроданным, ни без — поэтому в куртках только то, что
 * в продаже, и потолок 1 000. Семейство в наборе бывает чужим (ремень и брюки
 * с BOLSO) — раздел проверяем по английскому названию, как у ASOS.
 */
const ZARA_US = { name: "url", operator: "includes", value: "/us/en/" };
const ZARA_IN_STOCK = { name: "availability", operator: "=", value: true };
const zaraFilter = (families: string[], extra: unknown[] = []) => ({
  operator: "and",
  filters: [{ name: "section", operator: "=", value: "WOMAN" }, { name: "product_family", operator: "in", value: families }, ZARA_US, ...extra],
});

/**
 * CHAQUETA у Zara — общее семейство «жакетов»: кардиганы и вязаные жакеты, но
 * и куртки (рилс 06.10: 5854/722 «CHAQUETA CUELLO SUBIDO BOLSILLOS» — куртка с
 * воротником-стойкой и карманами). Отдельная выборка со своим потолком: куртки
 * витрины уже занимают почти всю тысячу. Трикотаж отсекаем уже в фильтре —
 * по английскому названию (`product_name`, у витрины США оно заглавными), —
 * и ещё раз у себя (keepPartRecord): по названию и описанию, по-английски и
 * по-испански. Блейзеры — не верхняя одежда (как у Uniqlo). «RIBBED» в фильтр
 * не идёт: фильтр — поиск подстроки, и «… WITH RIBBED TRIMS» у куртки потерялся
 * бы без возврата; рубчик решает правило у себя (отделку оно не трогает).
 */
const ZARA_CHAQUETA_NOT_IN_NAME = ["KNIT", "CARDIGAN", "CROCHET", "PUNTO", "TRICOT", "JERSEY", "SWEAT", "BLAZER", "POINTELLE", "MOHAIR", "ALPACA"];

/**
 * Uniqlo: готовый набор «Uniqlo Products» (проба 03.10) — запись на каждый
 * цвет и размер, номер модели в group_id, пол и раздел в product_category
 * («WOMEN > Outerwear > …»). Витрина одна — Испания, на английском. Куртки —
 * только размер S (item_id «…-003»), иначе одна модель — десяток записей;
 * жакеты-блейзеры не берём: это не верхняя одежда.
 *
 * Коллаборации (Uniqlo U, JW Anderson, UNIQLO : C, Comptoir des Cotonniers…)
 * на витрине ES лежат в «WOMEN > Special Collaborations > …», а не в
 * «Outerwear» (рилс 06.10: Uniqlo U Hybrid Down Short Jacket, 487882). Там всё
 * подряд — брюки, топы, трикотаж, — поэтому отдельная часть: куртки — по
 * названию верхней одежды, размер S, без блейзеров и трикотажа; сумки — по
 * названию сумки (размер у них один). Слово ищем в обоих регистрах: учитывает
 * ли его Bright Data, неизвестно, а лишняя запись дешевле пропущенной модели.
 */
const UNIQLO_SPAIN = { name: "store_country", operator: "=", value: "ES" };
const uniqloFilter = (category: string, extra: unknown[] = []) => ({
  operator: "and",
  filters: [UNIQLO_SPAIN, { name: "product_category", operator: "includes", value: category }, ...extra],
});
const UNIQLO_COLLABS = "WOMEN > Special Collaborations";
const UNIQLO_NOT_BLAZERS = { name: "product_category", operator: "not_includes", value: "Blazers" };
const UNIQLO_SIZE_S = { name: "item_id", operator: "includes", value: "-003" };
const bothCases = (words: string[]) => words.flatMap((w) => [w, w.toLowerCase()]);
const UNIQLO_OUTERWEAR_IN_TITLE = bothCases(["Jacket", "Coat", "Parka", "Blouson", "Down", "Puffer", "Gilet", "Vest", "Harrington", "Trench", "Windbreaker", "Anorak", "Poncho"]);
const UNIQLO_KNIT_IN_TITLE = bothCases(["Knit", "Sweater", "Cardigan"]);
const UNIQLO_BAG_IN_TITLE = bothCases(["Bag", "Tote", "Backpack", "Pouch", "Clutch"]);
/**
 * «Bag» — подстрока и в «Baggy Jeans», «Baggy Curve Pants». Размера у сумок в
 * фильтре нет, поэтому такие брюки пришли бы записью на каждый цвет и размер:
 * мы за них платим, а потолок части (100) обрезал бы настоящие сумки. «Charm»
 * не отсекаем: брелок — одна запись на цвет, а «… Bag with Charm» — сумка.
 */
const UNIQLO_NOT_BAG_IN_TITLE = bothCases(["Baggy"]);

/**
 * ASOS — по запросам (раздел новинок с параметром в адресе сборщик не берёт),
 * включая Mango; H&M — по разделу (`category_url`). Около 180 записей за прогон.
 */
export const BRIGHTDATA_TARGETS: CollectionTarget[] = [
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "bags", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: ["hobo bag", "shoulder bag", "crossbody bag", "tote bag"].map((keyword) => ({ keyword })),
  },
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "jackets", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: ["bomber jacket", "puffer jacket", "trench coat", "leather jacket"].map((keyword) => ({ keyword })),
  },
  // Mango своих новинок через Bright Data не отдаёт (сборщик только по ссылкам),
  // а ASOS Mango продаёт — берём его выдачу по бренду (живая проба 02.10).
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "bags", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: [{ keyword: "mango bag" }],
  },
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "jackets", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: [{ keyword: "mango jacket" }],
  },
  {
    sourceId: "S001", datasetId: "gd_lct4vafw1tgx27d4o0", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_zara",
    kind: "dataset", filter: zaraFilter(["CAZADORA", "ABRIGO", "GABARDINA", "PLUMIFERO", "PARKA"], [ZARA_IN_STOCK]), recordsLimit: 1000, weekdayUtc: 3,
  },
  {
    sourceId: "S001", datasetId: "gd_lct4vafw1tgx27d4o0", direction: "bags", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_zara",
    kind: "dataset", filter: zaraFilter(["BOLSO", "BOLSOS"]), recordsLimit: 300, weekdayUtc: 3,
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", recordsLimit: 400, weekdayUtc: 3,
    filter: uniqloFilter("WOMEN > Outerwear", [
      { name: "product_category", operator: "not_includes", value: "Blazers" },
      { name: "item_id", operator: "includes", value: "-003" },
    ]),
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "bags", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", recordsLimit: 300, weekdayUtc: 3,
    filter: uniqloFilter("WOMEN > Accessories > Bags"),
  },
  // Части разделов — после основных целей источника: сбой новой цели не мешает купить основные.
  {
    sourceId: "S001", datasetId: "gd_lct4vafw1tgx27d4o0", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_zara",
    kind: "dataset", part: "zara_chaqueta", recordsLimit: 600, weekdayUtc: 3,
    filter: zaraFilter(["CHAQUETA"], [ZARA_IN_STOCK, { name: "product_name", operator: "not_includes", value: ZARA_CHAQUETA_NOT_IN_NAME }]),
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", part: "uniqlo_collab", recordsLimit: 200, weekdayUtc: 3,
    filter: uniqloFilter(UNIQLO_COLLABS, [
      UNIQLO_NOT_BLAZERS,
      UNIQLO_SIZE_S,
      { name: "title", operator: "includes", value: UNIQLO_OUTERWEAR_IN_TITLE },
      { name: "title", operator: "not_includes", value: UNIQLO_KNIT_IN_TITLE },
    ]),
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "bags", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", part: "uniqlo_collab", recordsLimit: 100, weekdayUtc: 3,
    filter: uniqloFilter(UNIQLO_COLLABS, [
      { name: "title", operator: "includes", value: UNIQLO_BAG_IN_TITLE },
      { name: "title", operator: "not_includes", value: UNIQLO_NOT_BAG_IN_TITLE },
    ]),
  },
  {
    sourceId: "S007", datasetId: "gd_lebec5ir293umvxh5g", direction: "bags", discoverBy: "category", limitPerInput: 40, method: "brightdata_hm",
    inputs: [{ category_url: "https://www2.hm.com/en_us/women/products/bags.html" }],
  },
  {
    sourceId: "S007", datasetId: "gd_lebec5ir293umvxh5g", direction: "jackets", discoverBy: "category", limitPerInput: 40, method: "brightdata_hm",
    inputs: [{ category_url: "https://www2.hm.com/en_us/women/products/jackets-coats.html" }],
  },
];

export interface PendingSnapshot {
  snapshotId: string;
  datasetId: string;
  direction: AssortmentDirection;
  method: string;
  triggeredAt: string;
  kind?: "collect" | "dataset";
  /** Для выборки набора: потолок и отпечаток фильтра — проверить полноту и смену охвата. */
  recordsLimit?: number;
  coverage?: string;
  /** Отпечаток цели (входы сборщика или фильтр набора): у одного источника несколько целей с одним набором и разделом (ASOS — две пробы на раздел). */
  targetKey?: string;
  /** Часть раздела (CHAQUETA Zara, коллаборации Uniqlo): свой охват и своё правило отбора записей. */
  part?: TargetPart;
}

/** Отпечаток цели запуска: по нему повторный платный запуск узнаёт, что по этой цели проба уже ждёт. */
export function targetSignature(target: { kind?: "collect" | "dataset"; inputs?: unknown; filter?: unknown; discoverBy?: string | null }): string {
  return filterSignature(target.kind === "dataset" ? { filter: target.filter } : { inputs: target.inputs, discoverBy: target.discoverBy ?? null });
}

/** Запущенные пробы хранятся в capabilities источника — отдельной таблицы не заводим. */
export function readPending(capabilities: unknown): PendingSnapshot[] {
  const list = (capabilities as { brightdata_pending?: unknown } | null)?.brightdata_pending;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is PendingSnapshot =>
    Boolean(p) && typeof p.snapshotId === "string" && typeof p.datasetId === "string"
    && (p.direction === "bags" || p.direction === "jackets") && typeof p.triggeredAt === "string");
}

export function writePending(capabilities: unknown, pending: PendingSnapshot[]): Record<string, unknown> {
  const base = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? { ...(capabilities as Record<string, unknown>) } : {};
  base.brightdata_pending = pending;
  return base;
}

/** Раздел набора в capabilities: набор + раздел (у источника их бывает несколько) + часть раздела, если это часть. */
export function coverageKey(target: { datasetId: string; direction: AssortmentDirection; part?: string }): string {
  return target.part ? `${target.datasetId}|${target.direction}|${target.part}` : `${target.datasetId}|${target.direction}`;
}

/**
 * Что считается одной покупкой. Готовый набор — раздел (или часть раздела)
 * целиком, независимо от фильтра: сменили фильтр — тот же раздел в тот же день
 * второй раз не покупаем, новый фильтр пойдёт в следующий плановый день (или
 * `force=1`). У сборщика — ещё и входы: у ASOS две цели на раздел.
 */
export function purchaseKey(p: { datasetId: string; direction: AssortmentDirection; part?: string; kind?: "collect" | "dataset"; targetKey?: string }): string {
  return p.kind === "dataset" ? coverageKey(p) : `${coverageKey(p)}|${p.targetKey ?? ""}`;
}

/**
 * Когда что куплено (ключ покупки → время запуска). Очередь проб помнит покупку,
 * только пока выборку не забрали; после сбора повторный запуск в тот же день
 * купил бы раздел заново. Помним сутки — столько же, сколько живёт проба.
 */
export function readBought(capabilities: unknown): Record<string, string> {
  const map = (capabilities as { brightdata_bought?: unknown } | null)?.brightdata_bought;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return Object.fromEntries(Object.entries(map as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && Number.isFinite(Date.parse(e[1]))));
}

/** Куплено меньше суток назад — повторно без `force=1` не покупаем. */
export function boughtRecently(at: string | undefined, nowMs: number): boolean {
  return at !== undefined && nowMs - Date.parse(at) < PENDING_TTL_MS;
}

/** Записать отметки покупок; отметки старше суток уже ничего не решают — не копим. */
export function writeBought(capabilities: Record<string, unknown>, bought: Record<string, string>, nowMs: number): Record<string, unknown> {
  return { ...capabilities, brightdata_bought: Object.fromEntries(Object.entries(bought).filter(([, at]) => boughtRecently(at, nowMs))) };
}

/**
 * Сбой платного запуска — отдельно от last_error. Запуск (ср и сб, 05:00 UTC)
 * пишет причину в last_error, но сбор в 06:30 пишет last_error заново по своим
 * ошибкам и стёр бы её: выборка, которую не купили (фильтр части не принят),
 * не покупалась бы ни разу, а в «Источниках» было бы чисто. Сбор присоединяет
 * сбой запуска к своим ошибкам, пока следующий запуск источника не купит
 * выборку без сбоя; не дольше 8 суток — за это время плановый запуск уже был.
 */
export interface TriggerFailure {
  at: string;
  message: string;
}

export const TRIGGER_FAILURE_TTL_MS = 8 * 24 * 3600 * 1000;

export function readTriggerFailure(capabilities: unknown): TriggerFailure | null {
  const value = (capabilities as { brightdata_trigger_failure?: unknown } | null)?.brightdata_trigger_failure as Partial<TriggerFailure> | null | undefined;
  if (!value || typeof value !== "object" || typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) || typeof value.message !== "string") return null;
  return { at: value.at, message: value.message };
}

/** null — снять сбой (запуск купил без сбоя или сбой устарел). Остальное в capabilities не трогаем. */
export function writeTriggerFailure(capabilities: unknown, failure: TriggerFailure | null): Record<string, unknown> {
  const base = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? { ...(capabilities as Record<string, unknown>) } : {};
  if (failure) base.brightdata_trigger_failure = failure;
  else delete base.brightdata_trigger_failure;
  return base;
}

/** Строка для last_error сбора: «запуск 07.10 не удался: …» — пока сбой не снят и не старше 8 суток; иначе null. Дата — московская. */
export function triggerFailureNote(failure: TriggerFailure | null, nowMs: number): string | null {
  if (!failure) return null;
  const at = Date.parse(failure.at);
  if (nowMs - at >= TRIGGER_FAILURE_TTL_MS) return null;
  const msk = new Date(at + 3 * 3600 * 1000).toISOString();
  return `запуск ${msk.slice(8, 10)}.${msk.slice(5, 7)} не удался: ${failure.message}`;
}

/** Отпечаток фильтра: сменился фильтр — сменился охват раздела. */
export function filterSignature(filter: unknown): string {
  const text = JSON.stringify(filter ?? null);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function readCoverage(capabilities: unknown): Record<string, string> {
  const map = (capabilities as { brightdata_coverage?: unknown } | null)?.brightdata_coverage;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return Object.fromEntries(Object.entries(map as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function writeCoverage(capabilities: Record<string, unknown>, coverage: Record<string, string>): Record<string, unknown> {
  return { ...capabilities, brightdata_coverage: coverage };
}

/** «раздел «куртки»» или «раздел «куртки» (часть: Zara CHAQUETA без трикотажа)» — для предупреждений в «Источниках». */
export function sectionLabel(snapshot: { direction: AssortmentDirection; part?: TargetPart }): string {
  const section = `раздел «${snapshot.direction === "bags" ? "сумки" : "куртки"}»`;
  const part = snapshot.part ? PART_LABEL[snapshot.part] : undefined;
  return part ? `${section} (часть: ${part})` : section;
}

export interface DatasetVerdict {
  /** Новинки из выборки не показываем: раздел обрезан или только что сменил охват. */
  quiet: boolean;
  /** Запомнить охват раздела — выборка полная. */
  remember: boolean;
  warning: string | null;
}

/**
 * Можно ли верить новинкам выборки набора. Пришло столько, сколько потолок, —
 * раздел обрезан: новинки там случайные. Фильтр сменился (или охват ещё не
 * запомнен) — этот сбор становится базой раздела, новинки пойдут со следующего.
 */
export function datasetVerdict(rows: number, snapshot: Pick<PendingSnapshot, "recordsLimit" | "coverage" | "direction" | "part">, stored: string | undefined): DatasetVerdict {
  const truncated = snapshot.recordsLimit !== undefined && rows >= snapshot.recordsLimit;
  if (truncated) {
    return { quiet: true, remember: false, warning: `${sectionLabel(snapshot)} больше потолка выборки (${rows}) — новинки не показываем, нужен фильтр уже или потолок выше` };
  }
  const changed = snapshot.coverage !== undefined && stored !== snapshot.coverage;
  return { quiet: changed, remember: snapshot.coverage !== undefined, warning: null };
}

/**
 * Пересборка набора, а не новинки. Bright Data пересобирает записи, и старая
 * вещь может заново попасть под фильтр (03.10 через час после базы Zara
 * «появились» давние брюки и ремень). Разом больше четверти раздела и больше
 * десяти моделей — такому сбору не верим: ложится базой, в «Источниках»
 * предупреждение.
 */
export function looksLikeChurn(fresh: number, collected: number): boolean {
  return fresh > 10 && fresh > collected * 0.25;
}

/** Проба висит дольше суток — её уже не ждём. */
export const PENDING_TTL_MS = 24 * 3600 * 1000;

export interface MappedRecord {
  sourceItemId: string;
  url: string;
  title: string;
  brand: string | null;
  category: string;
  color: string | null;
  images: string[];
  reviews: number | null;
  rating: number | null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const first = (record: Record<string, unknown>, keys: string[]) => keys.map((k) => record[k]).find((v) => v !== undefined && v !== null && v !== "");

/**
 * Фото магазинов — в высоком разрешении. Bright Data отдаёт ссылки ASOS с
 * пресетом превью (`$n_240w$&wid=44` — 44 пикселя в ширину) или без
 * параметров (маленькое превью по умолчанию): 03.10 карточки в ленте были
 * размытыми. CDN магазинов сами отдают нужный размер по параметру.
 */
export function hiResImageUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.hostname === "images.asos-media.com") {
      url.search = "";
      return `${url.toString()}?$n_1920w$&wid=1200&fit=constrain`;
    }
    if (url.hostname === "image.hm.com" || url.hostname.endsWith(".hm.com")) {
      url.searchParams.set("imwidth", "1200");
      return url.toString();
    }
    if (url.hostname === "image.uniqlo.com") {
      url.searchParams.set("width", "1200");
      return url.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Мёртвые ссылки на фото: Zara убрала снимки старого вида
 * `static.zara.net/photos///2023…` (04.10 — 404 с любого адреса и с Referer),
 * а набор Bright Data «Zara - Products» их хранит. Живые — `/assets/public/…`.
 */
export function isDeadImageUrl(url: string): boolean {
  return /^https?:\/\/static\.zara\.net\/photos\//.test(url);
}

function imageList(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value) && !isDeadImageUrl(value)) {
      const url = hiResImageUrl(value);
      if (!out.includes(url)) out.push(url);
    }
    if (Array.isArray(value)) value.forEach(push);
  };
  for (const key of ["main_image", "image", "image_url", "image_urls", "additional_image_urls", "images"]) push(record[key]);
  return out.slice(0, 4);
}

/** Запись Bright Data (ASOS, H&M, Zara, Uniqlo) → поля находки. Ошибочные и без ссылки — null. */
export function mapRecord(raw: unknown): MappedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.error) return null;
  const url = str(first(record, ["url", "product_url"]));
  const title = str(first(record, ["name", "product_name", "title"]));
  if (!url || !title || !/^https?:\/\//.test(url)) return null;
  // group_id — модель Uniqlo: в наборе запись на каждый цвет и размер.
  const id = first(record, ["product_id", "product_code", "sku", "SKU", "id", "group_id"]);
  const brandRaw = first(record, ["brand", "brand_name"]);
  const brand = typeof brandRaw === "string" ? brandRaw.trim() : str((brandRaw as { name?: unknown } | undefined)?.name);
  const categoryRaw = first(record, ["category", "product_category", "product_family"]);
  return {
    sourceItemId: id != null ? String(id) : url.split("?")[0],
    url: url.split("?")[0],
    title,
    brand: brand || null,
    category: typeof categoryRaw === "string" ? categoryRaw : Array.isArray(categoryRaw) ? categoryRaw.map(String).join(" / ") : "",
    color: str(first(record, ["color", "colour"])),
    images: imageList(record),
    reviews: num(first(record, ["review_count", "reviews_count", "rating_count"])),
    rating: num(first(record, ["star_rating", "rating"])),
  };
}

/**
 * Трикотаж и не верхняя одежда в названии — по-английски и по-испански (у
 * Zara семейство по-испански, название витрины США — по-английски). Вязаный
 * жакет назван «jacket», и главное слово названия его не отсекает.
 */
const KNITWEAR_IN_NAME = /\b(?:knit|knits|knitted|knitwear|crochet|tricot|jersey|purl|sweat|sweaters?|sweatshirts?|hoodies?|punto|ganchillo|sudadera|ribbed|rib|pointelle)\b|c[aá]rdigan|canal[eé]|\bspun yarn\b/i;
/**
 * Мохер и альпака в названии жакета CHAQUETA у Zara — вязаный жакет. Только для
 * Zara: у коллабораций Uniqlo «Alpaca Blend Coat» — тканое пальто.
 */
const ZARA_KNIT_YARN_IN_NAME = /\b(?:mohair|alpaca)\b/i;
/**
 * Трикотажная отделка — не трикотаж: у бомбера «rib knit trims», «ribbed cuffs
 * and hem», «knit collar», у пуховика «knit lining». Такие обороты вырезаются
 * до проверки на трикотаж.
 */
const KNIT_TRIM = /\b(?:rib(?:bed)?[- ]?)?knit(?:ted)?\s+(?:trims?|cuffs?|collars?|hems?|waistbands?|linings?)\b|\b(?:rib|ribbed)\s+(?:trims?|cuffs?|collars?|hems?|waistbands?)\b/gi;
/**
 * В описании трикотаж — любое «knit» (кроме отделки, см. KNIT_TRIM) и пряжа:
 * у Zara вязаный жакет описан как «made of a soft knit fabric» или «made of
 * spun yarn», а не словом «knitwear».
 */
const KNITWEAR_IN_DESCRIPTION = /c[aá]rdigan|\bknit(?:s|ted|wear)?\b|\bspun yarn\b|\bpointelle\b|\bpurl\b|\bcrochet\b|\bchaqueta de punto\b/i;
const knitwear = (text: string, rule: RegExp) => rule.test(text.replace(KNIT_TRIM, " "));
/** Блейзер — не верхняя одежда («Tailored Jacket» у Uniqlo — тоже он); «Tailored Coat» — пальто, остаётся. */
const BLAZER_IN_NAME = /\bblazers?\b|\bamericana\b|\btailored jackets?\b/i;
/** Верхняя одежда по названию — для коллабораций Uniqlo, где в разделе всё подряд. */
const OUTERWEAR_IN_NAME = /\b(?:jackets?|coats?|overcoats?|raincoats?|parkas?|blousons?|down|puffers?|gilets?|vests?|harringtons?|trench(?:coats?)?|windbreakers?|anoraks?|ponchos?|capes?)\b/i;
/**
 * Жилет — верхняя одежда только с уточнением (пуховый, стёганый, флисовый) или
 * по разделу «Outerwear»: в коллаборациях раздел смешанный, и «Tailored Vest»,
 * «Linen Blend Vest», «Mesh Vest» — костюмные жилеты и топы. Жилет — когда
 * других слов верхней одежды в названии нет («Down Jacket» с «vest» — куртка).
 */
const VEST_IN_NAME = /\bvests?\b/i;
const NOT_VEST_OUTERWEAR = /\b(?:jackets?|coats?|overcoats?|raincoats?|parkas?|blousons?|harringtons?|trench(?:coats?)?|windbreakers?|anoraks?|ponchos?|capes?)\b/i;
const OUTER_VEST = /\b(?:down|padded|puffers?|puffertech|pufftech|fleece|quilted|insulated|gilets?)\b/i;

/**
 * Главное слово названия коллаборации. «UNIQLO : C Puffer Skirt» двоеточие
 * режет на фразу «uniqlo» — главного слова нет; тогда решает то, что после
 * метки линии: «C Puffer Skirt» — юбка, а не куртка.
 */
function collabHeadKind(name: string): ReturnType<typeof headKind> {
  const kind = headKind(name);
  if (kind !== null || !name.includes(":")) return kind;
  return headKind(name.slice(name.indexOf(":") + 1));
}

const recordName = (record: Record<string, unknown>) => str(first(record, ["product_name", "name", "title"])) ?? "";

/**
 * Окончательное правило части раздела — по сырой записи набора, до разбора.
 * Только женское: раздел записи, если он есть, должен быть женским (фильтр
 * набора это уже требует; здесь — на случай, если Bright Data его ослабит).
 * Zara CHAQUETA — без трикотажа и блейзеров. Коллаборации Uniqlo — куртки
 * только по названию верхней одежды, главным словом — куртка (брюки, топы,
 * юбки отсекаются), жилет — только верхний, без трикотажа и блейзеров; сумки —
 * разбором раздела.
 */
export function keepPartRecord(part: TargetPart, direction: AssortmentDirection, raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  const name = recordName(record);
  if (part === "zara_chaqueta") {
    const section = str(record.section);
    if (section && section.toUpperCase() !== "WOMAN") return false;
    const subfamily = str(first(record, ["product_subfamily", "subfamily"])) ?? "";
    const description = str(first(record, ["description", "product_description"])) ?? "";
    return !knitwear(`${name} ${subfamily}`, KNITWEAR_IN_NAME) && !ZARA_KNIT_YARN_IN_NAME.test(name) && !knitwear(description, KNITWEAR_IN_DESCRIPTION) && !BLAZER_IN_NAME.test(name);
  }
  const category = str(first(record, ["product_category", "category"]));
  if (category && !/^WOMEN\b/i.test(category)) return false;
  if (direction === "bags") return true;
  const vest = VEST_IN_NAME.test(name) && !NOT_VEST_OUTERWEAR.test(name);
  if (vest && !OUTER_VEST.test(name) && !/\bouterwear\b/i.test(category ?? "")) return false;
  return OUTERWEAR_IN_NAME.test(name) && collabHeadKind(name) === "jacket" && !knitwear(name, KNITWEAR_IN_NAME) && !BLAZER_IN_NAME.test(name);
}

/** Записи выборки, которые идут в раздел: у части — только прошедшие её правило; у основной выборки — все. */
export function partRecords(snapshot: Pick<PendingSnapshot, "part" | "direction">, rows: unknown[]): unknown[] {
  const part = snapshot.part;
  return part && Object.hasOwn(PART_LABEL, part) ? rows.filter((row) => keepPartRecord(part, snapshot.direction, row)) : rows;
}

/**
 * Одна вещь — одна запись. В наборе Zara товар повторяется по странам витрины
 * (us/en, uk/en…), а запись в базу одним пакетом не переносит один номер
 * дважды — 03.10 первый сбор Zara упал именно на этом. Оставляем первую
 * запись, но с фото, если у первой их не было.
 */
export function uniqueRecords(records: MappedRecord[]): MappedRecord[] {
  const byId = new Map<string, MappedRecord>();
  for (const record of records) {
    const seen = byId.get(record.sourceItemId);
    if (!seen || (seen.images.length === 0 && record.images.length > 0)) byId.set(record.sourceItemId, record);
  }
  return [...byId.values()];
}

export function asCatalogItem(record: MappedRecord): CatalogItem {
  return { sourceItemId: record.sourceItemId, handle: record.url, title: record.title, productType: record.category, tags: [], publishedAt: null };
}

/** Новинка, застрявшая без находки дольше этого, — уже не новинка: уходит в базу (каталог брендов). */
export const ORPHAN_DAYS = 30;

/**
 * Сироты раньше этой даты — хвосты старых ошибок (база по источнику до #1420,
 * пересборка Zara до предохранителя #1440), а не новинки: в базу, не в ленту.
 */
export const ORPHANS_SINCE = Date.parse("2026-10-04T00:00:00Z");

/**
 * Кого превращать в находки в этом сборе. «Сироты» — новинки прошлых сборов,
 * не ставшие находками (потолок 15 за прогон, сбой записи): их новизну уже
 * подтвердил прошлый доверенный сбор, поэтому они идут первыми (от старых к
 * новым) и даже тогда, когда этот сбор лёг базой. Затем — свежие. Сироты
 * старше 30 дней и записанные до ORPHANS_SINCE — в базу.
 */
export function novelCandidates(
  relevantIds: string[],
  fresh: Set<string>,
  orphans: Map<string, string>,
  nowMs: number,
  quiet: boolean,
): { create: string[]; expire: string[] } {
  const cutoff = Math.max(nowMs - ORPHAN_DAYS * 24 * 3600 * 1000, ORPHANS_SINCE);
  const present = relevantIds.filter((id) => orphans.has(id));
  const expire = present.filter((id) => Date.parse(orphans.get(id)!) < cutoff);
  const live = present.filter((id) => !expire.includes(id)).sort((a, b) => Date.parse(orphans.get(a)!) - Date.parse(orphans.get(b)!));
  const freshIds = quiet ? [] : relevantIds.filter((id) => fresh.has(id) && !orphans.has(id));
  return { create: [...new Set([...live, ...freshIds])], expire };
}

/**
 * Фото Zara. В основном наборе «Zara - Products» снимки старого вида удалены
 * Zara (404), у части записей их нет вовсе. Набор «Zara.com products» отдаёт
 * живые снимки `/assets/public/…`, но без пола и раздела. Поэтому список
 * моделей — из основного набора, а фото — из второго по номеру модели:
 * p-код из адреса (`…-p03833400.html`) = `group_id` (решение владельца 04.10,
 * ≈ +$1–2 в неделю; дальше выборка только по моделям без фото).
 */
export const ZARA_PHOTOS = {
  sourceId: "S001",
  datasetId: "gd_mls18psj2jiho44xpy",
  storeCountry: "US",
  /** Потолок выборки: запись — модель в цвете, 2–3 на модель. */
  recordsLimit: 900,
  /** Моделей за одну выборку. */
  maxCodes: 400,
};

/** Номер модели Zara из адреса карточки: «…-p03833400.html» → «03833400». */
export function zaraModelCode(url: string | null | undefined): string | null {
  return url?.match(/-p(\d{8})\.html/)?.[1] ?? null;
}

export function zaraPhotoFilter(codes: string[]) {
  return {
    operator: "and",
    filters: [
      { name: "store_country", operator: "=", value: ZARA_PHOTOS.storeCountry },
      { name: "group_id", operator: "in", value: codes.slice(0, ZARA_PHOTOS.maxCodes) },
    ],
  };
}

/** Живые фото «Zara.com products» по номеру модели: главное + дополнительные, до 4. */
export function zaraPhotosByCode(records: unknown[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of records) {
    const r = raw as { group_id?: unknown; image_url?: unknown; additional_image_urls?: unknown } | null;
    const code = typeof r?.group_id === "string" ? r.group_id : typeof r?.group_id === "number" ? String(r.group_id).padStart(8, "0") : null;
    if (!code) continue;
    const urls = [r?.image_url, ...(Array.isArray(r?.additional_image_urls) ? r.additional_image_urls : [])]
      .filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u) && !isDeadImageUrl(u));
    const prev = out.get(code) ?? [];
    for (const u of urls) if (prev.length < 4 && !prev.includes(u)) prev.push(u);
    if (prev.length) out.set(code, prev);
  }
  return out;
}

export interface PhotoPending {
  snapshotId: string;
  triggeredAt: string;
}

/** Выборки фото — отдельно от проб разделов: у них нет раздела и свой разбор. */
export function readPhotoPending(capabilities: unknown): PhotoPending[] {
  const list = (capabilities as { brightdata_photo_pending?: unknown } | null)?.brightdata_photo_pending;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is PhotoPending => Boolean(p) && typeof p.snapshotId === "string" && typeof p.triggeredAt === "string");
}

export function writePhotoPending(capabilities: Record<string, unknown>, pending: PhotoPending[]): Record<string, unknown> {
  return { ...capabilities, brightdata_photo_pending: pending };
}
