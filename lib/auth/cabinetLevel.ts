import { getServerSession } from "./server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Что сотрудник может делать В КОНКРЕТНОМ кабинете.
 *
 * Права были глобальные на пользователя: роль «внешний селлер» выключала запись
 * везде, и человек не мог поставить задачу менеджеру в своём же кабинете — при
 * том что задачи это его работа. Выдать роль пошире значило открыть заодно всё
 * остальное, включая ставки и цены.
 *
 * Теперь уровень задаётся на пару «сотрудник × кабинет»:
 *
 *   manager — ведёт работу: задачи, заметки, ярлыки, теги. Всё, что ОПИСЫВАЕТ
 *             и планирует, но не трогает деньги в кабинете маркетплейса.
 *   lead    — то же плюс управляющие действия: ставки, статусы кампаний, цены.
 *
 * Граница проведена по последствиям, а не по экранам: экраны менеджеру нужны те
 * же, а ошибка в заметке стоит недоразумения, ошибка в ставке — денег.
 */
export type CabinetLevel = "manager" | "lead";

export interface CabinetRights {
  /** Задачи, заметки, ярлыки, теги. */
  canAnnotate: boolean;
  /** Ставки, статусы кампаний, цены — всё, что меняет деньги в кабинете. */
  canOperate: boolean;
  /** Откуда взялось решение: пригодится в интерфейсе и при разборе жалоб. */
  source: "role" | "cabinet-level";
  level: CabinetLevel | null;
}

const NOTHING: CabinetRights = { canAnnotate: false, canOperate: false, source: "role", level: null };

function fromLevel(level: CabinetLevel): CabinetRights {
  return {
    canAnnotate: true,
    canOperate: level === "lead",
    source: "cabinet-level",
    level,
  };
}

/**
 * Права в кабинете. Порядок важен: персональный уровень сильнее глобальной роли,
 * но ТОЛЬКО если он задан. Отсутствие строки не должно менять поведение тех,
 * кого в таблицу не вносили.
 */
export async function cabinetRights(cabinetId: string | null): Promise<CabinetRights> {
  const session = await getServerSession();
  if (!session) return NOTHING;

  if (cabinetId) {
    const db = getSupabaseAdmin();
    if (db) {
      const { data, error } = await db
        .from("cabinet_access")
        .select("level")
        .eq("user_id", session.uid)
        .eq("cabinet_id", cabinetId)
        .maybeSingle();
      // Таблицы ещё нет или запрос не прошёл — падаем на роль, а не запрещаем
      // всё: иначе одна опечатка в схеме лишает людей работы.
      if (!error && data?.level === "manager") return fromLevel("manager");
      if (!error && data?.level === "lead") return fromLevel("lead");
    }
  }

  // Прежнее правило: внешний селлер только смотрит, остальные роли работают.
  const readOnly = session.role === "seller";
  return {
    canAnnotate: !readOnly,
    canOperate: !readOnly,
    source: "role",
    level: null,
  };
}
