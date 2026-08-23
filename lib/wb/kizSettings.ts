// Настройки сверки Честного Знака на кабинет.
//
// WB сам говорит, какие идентификаторы допустимы у задания, и по ним панель
// понимает, маркируется товар или нет. Но классифицирует WB не всё: часть
// заданий приходит без метаданных, и тогда «кода нет» неотличимо от «кода не
// бывает». Здесь — ручное дополнение к автоматике: владелец прячет предмет,
// про который знает, что он не маркируется.
//
// Прячем ПРЕДМЕТ, а не артикул: продавец мыслит категориями («пеналы не
// маркируются»), и новый артикул той же категории не должен возвращать
// ложную тревогу.

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface KizSettings {
  hiddenSubjects: string[];
  /** Кабинет вовсе не торгует маркируемым товаром — раздел прячется целиком. */
  notApplicable: boolean;
}

const EMPTY: KizSettings = { hiddenSubjects: [], notApplicable: false };

/** Сравнение предметов без оглядки на регистр и лишние пробелы. */
export const subjectKey = (value: unknown): string =>
  String(value ?? "").trim().toLocaleLowerCase("ru-RU");

export async function loadKizSettings(cabinetId: string): Promise<KizSettings> {
  const db = getSupabaseAdmin();
  if (!db) return EMPTY;
  const { data, error } = await db
    .from("kiz_reconcile_settings")
    .select("hidden_subjects, not_applicable")
    .eq("cabinet_id", cabinetId)
    .maybeSingle();
  // Таблицы ещё нет — работаем как раньше, без скрытий.
  if (error || !data) return EMPTY;
  return {
    hiddenSubjects: Array.isArray(data.hidden_subjects)
      ? data.hidden_subjects.map((item: unknown) => String(item ?? "")).filter(Boolean)
      : [],
    notApplicable: Boolean(data.not_applicable),
  };
}

export async function saveKizSettings(
  cabinetId: string,
  patch: Partial<KizSettings>,
  updatedBy: string | null,
): Promise<KizSettings> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("База недоступна");
  const current = await loadKizSettings(cabinetId);
  const next: KizSettings = {
    hiddenSubjects: patch.hiddenSubjects ?? current.hiddenSubjects,
    notApplicable: patch.notApplicable ?? current.notApplicable,
  };
  // Дубли и пустые строки не храним: список читает человек.
  const unique = [...new Map(next.hiddenSubjects.map((s) => [subjectKey(s), s.trim()])).values()].filter(Boolean);
  const { error } = await db.from("kiz_reconcile_settings").upsert({
    cabinet_id: cabinetId,
    hidden_subjects: unique,
    not_applicable: next.notApplicable,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  }, { onConflict: "cabinet_id" });
  if (error) throw new Error(error.message);
  return { hiddenSubjects: unique, notApplicable: next.notApplicable };
}
