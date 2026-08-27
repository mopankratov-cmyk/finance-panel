import { NextResponse } from "next/server";
import { runServerFinancialAnalysis } from "@/lib/opiu/telegramBot";
import { sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import {
  opiuReportRefreshPeriod,
  syncOpiuReportPeriod,
} from "@/lib/opiu/reportSync";
import { OPIU_BRANDS } from "@/lib/opiu/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 300;

function authorized(request: Request) {
  const supplied = request.headers.get("authorization");
  const secrets = [process.env.FINANCE_MONITOR_SECRET, process.env.CRON_SECRET].filter(Boolean);
  return secrets.some((secret) => supplied === `Bearer ${secret}`);
}

async function runFinancialMonitor(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    const now = new Date();
    const reportPeriod = opiuReportRefreshPeriod(now);
    const forecastYear = Number(reportPeriod.dateTo.slice(0, 4));
    const forecastMonth = Number(reportPeriod.dateTo.slice(5, 7));
    // Синкаем финотчёт WB по КАЖДОМУ бренду отдельно — один упавший кабинет
    // не должен блокировать обновление остальных.
    const reportSyncByBrand = await Promise.all(OPIU_BRANDS.map(async (b) => {
      try {
        return { brand: b, result: await syncOpiuReportPeriod(reportPeriod, b.cabinetId), error: null as string | null };
      } catch (error) {
        return {
          brand: b,
          result: null,
          error: error instanceof Error ? error.message : "Не удалось обновить финансовый отчёт WB",
        };
      }
    }));
    const reportSync = reportSyncByBrand[0]?.result ?? null;
    const failedBrandSyncs = reportSyncByBrand.filter((r) => r.error);
    const reportSyncError = failedBrandSyncs.length > 0
      ? failedBrandSyncs.map((r) => `${r.brand.label}: ${r.error}`).join("; ")
      : null;
    const forecast = await buildMarketplacePayoutForecast(forecastYear, forecastMonth);
    const result = await runServerFinancialAnalysis({ notify: true });
    const db = getSupabaseAdmin();
    if (db) {
      const signals = [
        ...(reportSyncError ? [{
          key: "wb-report-sync",
          text: `⚠️ <b>Не обновился финансовый отчёт WB</b>\n${reportSyncError}\nОПиУ продолжает работать на последнем успешном снимке.`,
        }] : []),
        ...forecast.weatherWarnings.map((warning) => ({
          key: `weather:${warning.article}:${forecastYear}-${forecastMonth}`,
          text: `🌦️ <b>Погода влияет на ${warning.article}</b>\n${warning.reason}\nКорректировка прогноза: +${warning.adjustmentPercent.toFixed(1)}%`,
        })),
        ...(forecast.stableDeviationDays >= 3 ? [{
          key: `sales-deviation:${forecastYear}-${forecastMonth}:${Math.sign(forecast.currentDeviation)}`,
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
      if (!reportSyncError) {
        await db
          .from("finance_alerts")
          .update({
            status: "resolved",
            last_seen_at: new Date().toISOString(),
          })
          .eq("alert_key", "wb-report-sync")
          .eq("status", "open");
      }
    }
    return NextResponse.json({
      finance: result,
      forecast,
      reportSync: reportSync
        ? { period: reportPeriod, ...reportSync }
        : null,
      reportSyncError,
      reportSyncByBrand: reportSyncByBrand.map((r) => ({
        brand: r.brand.id,
        label: r.brand.label,
        synced: r.result?.synced ?? null,
        error: r.error,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка финансового мониторинга" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return runFinancialMonitor(request);
}

export async function GET(request: Request) {
  return runFinancialMonitor(request);
}
