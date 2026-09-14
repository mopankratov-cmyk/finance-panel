import { DDS_CATEGORIES } from "./categories";
import { MONTHLY_OPIU_ARTICLES } from "@/lib/opiu/monthlyStatement";

export interface DdsExpenseCategory {
  id: string;
  name: string;
  opiuArticleId: string | null;
}

const EXPENSE_TARGET_IDS = new Set([
  "external_ads", "barter", "cashback", "external_target_ads", "fulfillment",
  "transport", "bank_fees", "training", "personnel", "recruitment",
  "admin_contractors", "software", "office", "self_purchases", "marketing_contractors",
]);

export const DDS_OPIU_EXPENSE_TARGETS = MONTHLY_OPIU_ARTICLES.filter((article) => EXPENSE_TARGET_IDS.has(article.id));
const normalize = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");

export function validateExpenseCategory(input: Record<string, unknown>): { name: string; opiuArticleId: string | null } {
  if (typeof input.name !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(input.name)) throw new Error("Укажите название статьи от 1 до 160 символов без управляющих символов");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (input.opiuArticleId != null && typeof input.opiuArticleId !== "string") throw new Error("Выберите обычную расходную статью ОПиУ из списка");
  const opiuArticleId = input.opiuArticleId == null || input.opiuArticleId === "" ? null : input.opiuArticleId as string;
  if (!name || name.length > 160) throw new Error("Укажите название статьи от 1 до 160 символов");
  if ([...DDS_CATEGORIES, "Кэшбек"].some((category) => normalize(category) === normalize(name))) throw new Error("Такая статья уже есть в основном справочнике");
  if (opiuArticleId && !EXPENSE_TARGET_IDS.has(opiuArticleId)) throw new Error("Выберите обычную расходную статью ОПиУ из списка");
  return { name, opiuArticleId };
}
