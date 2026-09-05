// Рамки на пополнение рекламного бюджета.
//
// Пополнение — единственное действие модуля, которое двигает деньги наружу и
// ничем не отменяется: WB не умеет вернуть сумму из бюджета кампании обратно на
// счёт. Поэтому здесь два независимых предохранителя, а не один.
//
//   Потолок за операцию защищает от опечатки в поле суммы: лишний ноль в
//   «5000» превращает её в 50 000, и без потолка это уходит в WB без вопросов.
//
//   Суточный лимит на кабинет защищает от другого — от повторов. Опечатку
//   человек замечает, а десять аккуратных пополнений подряд, каждое в рамках
//   потолка, выглядят нормально в каждый отдельный момент и складываются в
//   сумму, которую никто не планировал.
//
// Оба значения переопределяются переменными окружения: границы разумного
// зависят от оборота кабинета, и вшивать сюда чужую норму было бы самонадеянно.

import type { SupabaseClient } from "@supabase/supabase-js";

import { moscowToday } from "@/lib/sync/moscowDay";

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Потолок одной операции, в базовых единицах валюты кабинета. */
export function depositMaxPerOperation(): number {
  return envNumber("WB_ADVERT_DEPOSIT_MAX_ONCE", 10_000);
}

/**
 * Потолок суммы пополнений по кабинету за московские сутки.
 *
 * Это последний автоматический тормоз перед необратимым движением денег:
 * вернуть сумму из бюджета кампании WB не умеет. Поэтому число живёт в коде и
 * меняется правкой, которую видно в истории, а не тихой переменной окружения.
 *
 * 30 000 → 100 000 по требованию владельца 05.09.2026: план пополнения на день
 * составил 52 500 ₽ по одиннадцати кампаниям одного кабинета и не проходил
 * прежний потолок. Потолок ОДНОЙ операции при этом не тронут — он остаётся
 * 10 000, и разовое пополнение крупнее по-прежнему отбивается.
 */
export function depositMaxPerDay(): number {
  return envNumber("WB_ADVERT_DEPOSIT_MAX_DAY", 100_000);
}

/**
 * Начало текущих московских суток как момент времени.
 *
 * Москва с 2014 года стоит на UTC+3 без переходов, поэтому смещение можно
 * записать константой. Считать сутки по UTC было бы тихой ошибкой: с 00:00 до
 * 03:00 по Москве UTC-дата ещё вчерашняя, и суточный лимит в эти часы
 * обнулялся бы не тогда, когда его ждёт человек.
 */
export function moscowDayStart(now: Date = new Date()): string {
  return `${moscowToday(now)}T00:00:00+03:00`;
}

export interface DepositAllowance {
  /** Сколько уже пополнено по кабинету за сегодня. */
  spentToday: number;
  maxPerOperation: number;
  maxPerDay: number;
  /** Сколько ещё можно пополнить сегодня. */
  remainingToday: number;
}

interface JournalRow {
  new_value: unknown;
}

/**
 * Сумма успешных пополнений кабинета за сегодня — из того же журнала, который
 * пишется на каждую операцию.
 *
 * Отдельной таблицы-счётчика намеренно нет: два источника правды о потраченном
 * разошлись бы при первом же сбое между записью в WB и записью счётчика, и
 * разошлись бы молча. Журнал — единственная запись факта, лимит считается из неё.
 */
export async function depositAllowance(
  db: SupabaseClient,
  cabinetId: string,
  now: Date = new Date(),
): Promise<DepositAllowance> {
  const maxPerOperation = depositMaxPerOperation();
  const maxPerDay = depositMaxPerDay();

  const { data, error } = await db
    .from("advert_bid_changes")
    .select("new_value")
    .eq("cabinet_id", cabinetId)
    .eq("action", "deposit")
    .eq("status", "ok")
    .gte("created_at", moscowDayStart(now));

  // Не смогли прочитать журнал — считаем, что сегодня уже израсходован весь
  // лимит. Это неудобно, но единственный безопасный вариант: пустить деньги
  // при неизвестном остатке значит снять предохранитель именно тогда, когда
  // что-то уже сломано.
  if (error) {
    return { spentToday: maxPerDay, maxPerOperation, maxPerDay, remainingToday: 0 };
  }

  const spentToday = (data ?? []).reduce((total: number, row: JournalRow) => {
    const value = row.new_value;
    if (!value || typeof value !== "object") return total;
    const sum = Number((value as { sum?: unknown }).sum);
    return Number.isFinite(sum) && sum > 0 ? total + sum : total;
  }, 0);

  return {
    spentToday,
    maxPerOperation,
    maxPerDay,
    remainingToday: Math.max(0, maxPerDay - spentToday),
  };
}

export type DepositVerdict =
  | { allowed: true; allowance: DepositAllowance }
  | { allowed: false; reason: string; allowance: DepositAllowance };

/**
 * Пропускать ли пополнение. Минимум приходит от WB (`minTopUp` из конфига
 * кабинета), а не константой: у кабинета может быть не рубль, и «минимум 50»
 * в такой валюте — выдуманное число.
 */
export function judgeDeposit(input: {
  sum: number;
  minTopUp: number;
  allowance: DepositAllowance;
}): DepositVerdict {
  const { sum, minTopUp, allowance } = input;

  if (!Number.isFinite(sum) || sum <= 0 || !Number.isInteger(sum)) {
    return { allowed: false, reason: "Сумма должна быть целым числом больше нуля.", allowance };
  }
  if (sum < minTopUp) {
    return { allowed: false, reason: `WB не примет меньше ${minTopUp}. Это минимум пополнения для вашего кабинета.`, allowance };
  }
  if (sum > allowance.maxPerOperation) {
    return {
      allowed: false,
      reason: `Потолок одной операции — ${allowance.maxPerOperation}. Запрошено ${sum}.`,
      allowance,
    };
  }
  if (sum > allowance.remainingToday) {
    return {
      allowed: false,
      reason: `Суточный лимит кабинета ${allowance.maxPerDay} почти выбран: сегодня пополнено ${allowance.spentToday}, осталось ${allowance.remainingToday}.`,
      allowance,
    };
  }
  return { allowed: true, allowance };
}
