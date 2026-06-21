import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { collectBalances, loadThresholds } from "@/lib/factory/balances";
import { notifyOwner } from "@/lib/factory/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Суточный тик балансов: снимает баланс каждого сервиса в историю + алертит, когда баланс <= порога.
// Вызывается из /api/factory/jobs/balances-cron (GET, Bearer CRON_SECRET) или кнопкой из кокпита.
// Антидребезг: один сервис алертит не чаще раза в сутки (service_thresholds.alerted_at).
// «Выздоровел» (стал выше порога) → alerted_at сбрасываем, чтобы следующее падение снова сработало.
// Канал: Telegram (notifyOwner). Нет токена/чата → алерт всё равно громко виден в дашборде (красный бейдж).

const fmtBal = (b: number | null, cur: string) => (b == null ? "—" : cur === "USD" ? `$${b.toFixed(2)}` : `${Math.round(b * 100) / 100} cr`);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const secret = (body.secret || "").toString();
  if (secret && secret !== (process.env.CRON_SECRET || "")) {
    return NextResponse.json({ error: "неверный secret" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  try {
    // снимок всех сервисов (throttleMs=0 → пишем всегда)
    const services = await collectBalances(db, { persist: true, throttleMs: 0 });
    const thresholds = await loadThresholds(db);
    const now = Date.now();

    const low = services.filter((s) => s.low);
    const recovered = services.filter((s) => !s.low && thresholds[s.service]?.alerted_at);

    // кто «созрел» для алерта: низкий И (не алертили / прошли сутки)
    const due = low.filter((s) => {
      const a = thresholds[s.service]?.alerted_at;
      return !a || (now - new Date(a).getTime()) >= DAY_MS;
    });

    let notify: { sent: boolean; error?: string } = { sent: false };
    if (due.length) {
      const lines = due.map((s) => `• ${s.label}: ${fmtBal(s.balance, s.currency)} (порог ${fmtBal(s.threshold, s.currency)})`);
      const text = `⚠️ Кончаются бабки на сервисах завода:\n${lines.join("\n")}\n\nПополни, иначе генерация встанет.`;
      notify = await notifyOwner(text);
      // помечаем все НИЗКИЕ сервисы как «оповещённые сейчас» (debounce на сутки)
      for (const s of low) {
        try { await db.from("service_thresholds").upsert({ service: s.service, threshold: s.threshold, alerted_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "service" }); } catch { /* best-effort */ }
      }
    }
    // выздоровевшие — снять метку, чтобы следующее падение снова алертило
    for (const s of recovered) {
      try { await db.from("service_thresholds").upsert({ service: s.service, threshold: s.threshold, alerted_at: null, updated_at: new Date().toISOString() }, { onConflict: "service" }); } catch { /* best-effort */ }
    }

    return NextResponse.json({
      ok: true,
      snapshotted: services.length,
      low: low.map((s) => ({ service: s.service, balance: s.balance, currency: s.currency, threshold: s.threshold })),
      alerts_due: due.map((s) => s.service),
      recovered: recovered.map((s) => s.service),
      notify,
    });
  } catch (e) {
    return NextResponse.json({ error: "balances-tick crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
