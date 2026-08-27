import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { syncOpiuReportPeriod } from "@/lib/opiu/reportSync";
import { resolveOpiuBrand } from "@/lib/opiu/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Ручной пересинк финотчёта WB за период. Нужен, когда в отчёт добавили поле
// (например cashback_discount) и старые строки его не содержат: ночной монитор
// закроет пробел сам, но ждать до утра не всегда уместно.
//
// Только пересинк — без телеграм-уведомлений и анализа, которые делает
// /api/opiu/monitor: у ручного запуска не должно быть побочных эффектов.
const MANUAL_ROLES = ["director", "finance"] as const;
const MAX_PERIOD_DAYS = 92;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Машинный вызов — только CRON_SECRET: гейт-прокси знает именно его, и обещать
// здесь FINANCE_MONITOR_SECRET значило бы дать мёртвый ключ (запрос умер бы в
// прокси, не дойдя до роута — ровно как было с секретом сборщика «Полок»).
function machineAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  // Машинный вызов по секрету ИЛИ человек, отвечающий за деньги.
  if (!machineAuthorized(request)) {
    const gate = await requireApiSession([...MANUAL_ROLES]);
    if (gate) return gate;
  }

  const body = (await request.json().catch(() => ({}))) as { dateFrom?: string; dateTo?: string; brand?: string };
  const dateFrom = String(body.dateFrom ?? "").trim();
  const dateTo = String(body.dateTo ?? "").trim();
  const brand = resolveOpiuBrand(body.brand);
  if (!ISO_RE.test(dateFrom) || !ISO_RE.test(dateTo)) {
    return NextResponse.json({ error: "Даты нужны в формате ГГГГ-ММ-ДД" }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "Начало периода позже его конца" }, { status: 400 });
  }
  const days = Math.round(
    (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  // Пересинк перекачивает отчёт целиком: длинное окно бьёт по лимитам WB и
  // времени функции, поэтому просим сузить, а не молча режем период.
  if (days > MAX_PERIOD_DAYS) {
    return NextResponse.json(
      { error: `Период не больше ${MAX_PERIOD_DAYS} дней, запрошено ${days}` },
      { status: 400 },
    );
  }

  try {
    const result = await syncOpiuReportPeriod({ dateFrom, dateTo }, brand.cabinetId);
    return NextResponse.json({ ok: true, period: { dateFrom, dateTo, days }, brand: brand.id, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось пересинкать отчёт WB" },
      { status: 502 },
    );
  }
}
