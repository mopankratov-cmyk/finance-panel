// V7/R6 · Петля обучения: возвращаем НАКОПЛЕННЫЙ сигнал ниши обратно в идеацию/декомпозицию/критика.
// Раньше cf_signals (reason_chip провалов) был write-only (читал только balances.ts-счётчик) —
// одобрения/браки никуда не возвращались. Теперь decompose/критик калибруются под РЕАЛЬНО
// залетавшее (winners) и часто-бракуемое (rejects) в нише → завод компаундит, а не повторяет дыры.
// Всё best-effort (таблицы могут быть не применены) — пустая строка вместо падения.

import type { SupabaseClient } from "@supabase/supabase-js";

// Победители ниши (одобрено оператором / реально зашло) → бери дух/механику.
export async function winnersHintFor(db: SupabaseClient, niche: string): Promise<string> {
  try {
    const { data } = await db.from("content_assets").select("winner_learnings,name")
      .eq("niche", niche).eq("is_winner", true).order("winner_at", { ascending: false }).limit(5);
    const list = ((data || []) as { winner_learnings?: Record<string, unknown>; name?: string }[])
      .map((w) => String((w.winner_learnings?.hook as string) || w.name || "").trim()).filter(Boolean).slice(0, 5);
    return list.length ? `\nНАШИ ПОБЕДИТЕЛИ В НИШЕ (реально зашло — бери дух/механику, не копируй дословно): ${list.map((h) => `«${h}»`).join(" | ")}` : "";
  } catch { return ""; }
}

// Корпус хуков ниши по viability (проверены) → бери паттерн.
export async function corpusHooksFor(db: SupabaseClient, niche: string): Promise<string> {
  try {
    const { data } = await db.from("viral_hooks").select("hook_text,viability_score")
      .eq("niche", niche).order("viability_score", { ascending: false }).limit(10);
    const hooks = ((data || []) as { hook_text: string }[]).map((h) => h.hook_text).filter(Boolean).slice(0, 8);
    return hooks.length ? `\nКОРПУС ХУКОВ НИШИ (проверены — бери ПАТТЕРН, не дословно): ${hooks.map((h) => `«${h}»`).join(" | ")}` : "";
  } catch { return ""; }
}

// АНТИ-паттерны: что оператор/ОТК чаще всего бракуют в нише (из cf_signals event=rejected reason_chip). V7-ядро.
export async function rejectAntiFor(db: SupabaseClient, niche: string): Promise<string> {
  try {
    const { data } = await db.from("cf_signals").select("reason_chip")
      .eq("event", "rejected").eq("niche", niche).not("reason_chip", "is", null)
      .order("created_at", { ascending: false }).limit(120);
    const counts: Record<string, number> = {};
    ((data || []) as { reason_chip: string }[]).forEach((r) => { const c = String(r.reason_chip || "").trim(); if (c) counts[c] = (counts[c] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return top.length ? `\nЧАСТО БРАКУЮТ В НИШЕ (избегай этих дыр, ищи другие углы): ${top.map(([c, n]) => `${c} (×${n})`).join(", ")}` : "";
  } catch { return ""; }
}

// Полный грундинг ниши: победители + корпус + анти-паттерны. Для decompose/идей.
export async function learningHints(db: SupabaseClient, niche: string): Promise<string> {
  if (!niche) return "";
  const [w, c, r] = await Promise.all([winnersHintFor(db, niche), corpusHooksFor(db, niche), rejectAntiFor(db, niche)]);
  return w + c + r;
}
