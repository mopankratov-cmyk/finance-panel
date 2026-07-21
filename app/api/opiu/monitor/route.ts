import { NextResponse } from "next/server";
import { runServerFinancialAnalysis } from "@/lib/opiu/telegramBot";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

function authorized(request: Request) {
  const supplied = request.headers.get("authorization");
  const secrets = [process.env.FINANCE_MONITOR_SECRET, process.env.CRON_SECRET].filter(Boolean);
  return secrets.some((secret) => supplied === `Bearer ${secret}`);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    const now = new Date();
    const forecast = await buildMarketplacePayoutForecast(now.getFullYear(), now.getMonth() + 1);
    const result = await runServerFinancialAnalysis({ notify: true });
    const db = getSupabaseAdmin();
    if (db) {
      const signals = [
        ...forecast.weatherWarnings.map((warning) => ({
          key: `weather:${warning.article}:${now.getFullYear()}-${now.getMonth() + 1}`,
          text: `🌦️ <b>Погода влияет на ${warning.article}</b>\n${warning.reason}\nКорректировка прогноза: +${warning.adjustmentPercent.toFixed(1)}%`,
        })),
        ...(forecast.stableDeviationDays >= 3 ? [{
          key: `sales-deviation:${now.getFullYear()}-${now.getMonth() + 1}:${Math.sign(forecast.currentDeviation)}`,
          text: `📉 <b>Устойчивое отклонение продаж</b>\nОтклонение ${(forecast.currentDeviation * 100).toFixed(1)}% держится ${forecast.stableDeviationDays} дня. Адаптивный план пересчитан.`,
        }] : []),
      ];
      for (const signal of signals) {
        const { data: existing } = await db.from("finance_alerts").select("id").eq("alert_key", signal.key).maybeSingle();
        await db.from("finance_alerts").upsert({
          alert_key: signal.key,
          severity: "warning",
          title: "Сигнал прогноза",
          message: signal.text.replace(/<[^>]+>/g, ""),
          action: "Проверить обновлённый прогноз поступлений",
          status: "open",
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "alert_key" });
        if (!existing) await sendTelegramMessage(signal.text);
      }
    }
    return NextResponse.json({ finance: result, forecast });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка финансового мониторинга" },
      { status: 500 },
    );
  }
}
