import type { AssortmentDirection } from "./constants";

/**
 * Ниши «Китай (1688)» (проба 06.10.2026): китайские ключи и русские названия, только женское. Чистый модуль без зависимостей — его
 * импортирует и экран (вкладка «Китай (1688)», страница ссылок на китайские площадки), а клиент 1688 (china1688.ts) реэкспортирует.
 */

export interface ChinaNiche {
  key: string;
  direction: AssortmentDirection;
  ru: string;
  /** Ключи поиска: первый — основной (один вызов в неделю), остальные — синонимы на будущее. */
  zh: readonly string[];
  /** Короткий ключ тренда (≤5 иероглифов, как советует документация offer_hot). */
  trendKey: string;
  /** Дополнительные формы для CLÉRIN. */
  clerin?: true;
}

/** Версия набора ниш: поменяли состав — новые ниши снимаются со следующего прогона, снятые просто не обновляются. */
export const CHINA_NICHES_VERSION = "cn-niches-v1 (проба 06.10.2026)";

export const CHINA_NICHES: readonly ChinaNiche[] = [
  { key: "bomber", direction: "jackets", ru: "Женская куртка-бомбер", zh: ["飞行员夹克 女", "棒球服 女"], trendKey: "飞行员夹克" },
  { key: "short_down", direction: "jackets", ru: "Короткий женский пуховик", zh: ["短款羽绒服 女", "面包服 女 短款"], trendKey: "短款羽绒服" },
  { key: "shirt_jacket", direction: "jackets", ru: "Женская куртка-рубашка", zh: ["衬衫式夹克 女", "衬衫外套 女 秋"], trendKey: "衬衫式夹克" },
  { key: "trench", direction: "jackets", ru: "Женский тренч", zh: ["风衣 女", "风衣 女 短款"], trendKey: "风衣 女" },
  { key: "suede", direction: "jackets", ru: "Женская замшевая куртка", zh: ["麂皮绒外套 女", "反绒皮夹克 女"], trendKey: "麂皮绒外套" },
  { key: "leather", direction: "jackets", ru: "Женская кожаная куртка", zh: ["皮衣 女 短款", "机车皮衣 女"], trendKey: "皮衣 女" },
  { key: "fleece", direction: "jackets", ru: "Женская флисовая куртка", zh: ["摇粒绒外套 女", "抓绒夹克 女"], trendKey: "摇粒绒外套" },
  { key: "windbreaker", direction: "jackets", ru: "Женская ветровка", zh: ["防风夹克 女 薄款", "冲锋衣 女 单层"], trendKey: "防风夹克" },
  { key: "padded_short", direction: "jackets", ru: "Женская короткая куртка на синтепоне", zh: ["棉服 女 短款", "立领棉服 女"], trendKey: "棉服 女" },
  { key: "crossbody", direction: "bags", ru: "Женская сумка кросс-боди", zh: ["斜挎包 女", "小方包 女 斜挎"], trendKey: "斜挎包" },
  { key: "hobo", direction: "bags", ru: "Женская сумка-хобо", zh: ["hobo包 女", "流浪包 女"], trendKey: "hobo包" },
  { key: "tote", direction: "bags", ru: "Женский тоут", zh: ["托特包 女", "通勤托特包 大容量"], trendKey: "托特包" },
  { key: "baguette", direction: "bags", ru: "Женская сумка-багет", zh: ["法棍包 女"], trendKey: "法棍包" },
  { key: "underarm", direction: "bags", ru: "Женская сумка под мышку", zh: ["腋下包 女"], trendKey: "腋下包" },
  { key: "bucket", direction: "bags", ru: "Женская сумка-ведро", zh: ["水桶包 女"], trendKey: "水桶包" },
  { key: "shopper", direction: "bags", ru: "Женская сумка-шопер", zh: ["购物袋 女 大容量", "帆布包 女 大容量"], trendKey: "帆布包" },
  { key: "backpack", direction: "bags", ru: "Женский рюкзак", zh: ["双肩包 女", "女士小背包"], trendKey: "女士双肩包" },
  { key: "dumpling", direction: "bags", ru: "Сумка-«пельмень» (CLÉRIN)", zh: ["饺子包"], trendKey: "饺子包", clerin: true },
  { key: "saddle", direction: "bags", ru: "Сумка-седло (CLÉRIN)", zh: ["马鞍包 女"], trendKey: "马鞍包", clerin: true },
  { key: "envelope", direction: "bags", ru: "Сумка-конверт (CLÉRIN)", zh: ["信封包 女"], trendKey: "信封包", clerin: true },
  { key: "suede_bag", direction: "bags", ru: "Замшевая сумка (CLÉRIN)", zh: ["麂皮 包 女"], trendKey: "麂皮包", clerin: true },
];
