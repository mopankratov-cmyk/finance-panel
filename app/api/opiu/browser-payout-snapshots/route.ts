import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadPlanningState, writePlanningStateSnapshot } from "@/lib/planning/stateStore";
import { browserPayoutMonthKey, normalizeBrowserPayoutSnapshot, normalizeBrowserPayoutStore, upsertBrowserPayoutSnapshot } from "@/lib/opiu/browserPayoutSnapshots";
import { getOzonPayoutMapping } from "@/lib/opiu/ozonPayoutIdentity";

const STORE_KEY = "marketplace_payout_browser_v1";

function machineAuthorized(request: Request) {
  const supplied = request.headers.get("authorization");
  const secrets = [process.env.FINANCE_MONITOR_SECRET, process.env.CRON_SECRET].filter(Boolean);
  return secrets.some((secret) => supplied === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const year = Number(request.nextUrl.searchParams.get("year"));
  const marketplace = request.nextUrl.searchParams.get("marketplace");
  const cabinetId = String(request.nextUrl.searchParams.get("cabinet") ?? "");
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2025 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || !(marketplace === "wb" || marketplace === "ozon") || !cabinetId) {
    return NextResponse.json({ error: "Некорректный кабинет, маркетплейс или год" }, { status: 400 });
  }
  const session = await getServerSession();
  if (!sessionHasCabinetAccess(session, cabinetId)) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База данных не настроена" }, { status: 503 });
  const snapshot = await loadPlanningState<Record<string, unknown>>(db, year);
  const store = normalizeBrowserPayoutStore(snapshot.data[STORE_KEY]);
  return NextResponse.json({
    // Снимок без дня выплаты относим к месяцу по концу отчётного периода:
    // кабинет платит именно за него (browserPayoutMonthKey).
    snapshots: store.snapshots.filter((row) => row.marketplace === marketplace && row.cabinetId === cabinetId
      && browserPayoutMonthKey(row) === `${year}-${String(month).padStart(2, "0")}`),
  });
}

export async function POST(request: Request) {
  if (!machineAuthorized(request)) return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  const body = await request.json().catch(() => null) as { snapshot?: unknown } | null;
  const incoming = normalizeBrowserPayoutSnapshot(body?.snapshot);
  if (!incoming) return NextResponse.json({ error: "Некорректный снимок выплаты" }, { status: 400 });
  const year = Number(browserPayoutMonthKey(incoming).slice(0, 4));
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База данных не настроена" }, { status: 503 });
  if (incoming.marketplace === "ozon") {
    const mapping = getOzonPayoutMapping(incoming.cabinetId);
    if (!mapping || mapping.companyId !== incoming.companyId || mapping.receivingAccountId !== incoming.accountId) {
      return NextResponse.json({ error: "Снимок не соответствует подтверждённой настройке кабинета Ozon" }, { status: 409 });
    }
  }
  const [company, account] = await Promise.all([
    db.from("companies").select("id").eq("id", incoming.companyId).eq("is_active", true).maybeSingle(),
    db.from("accounts").select("id").eq("id", incoming.accountId).maybeSingle(),
  ]);
  if (company.error || !company.data || account.error || !account.data) {
    return NextResponse.json({ error: "Компания или счёт снимка не найдены" }, { status: 409 });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await loadPlanningState<Record<string, unknown>>(db, year);
    const store = normalizeBrowserPayoutStore(current.data[STORE_KEY]);
    const nextStore = upsertBrowserPayoutSnapshot(store, incoming);
    const result = await writePlanningStateSnapshot(db, year, current, {
      ...current.data,
      [STORE_KEY]: nextStore,
    }, new Date().toISOString());
    if (result.ok) return NextResponse.json({ ok: true });
    if (!("conflict" in result) || !result.conflict) return NextResponse.json({ error: "Не удалось сохранить снимок выплаты" }, { status: 500 });
  }
  return NextResponse.json({ error: "Данные изменились одновременно, повторите отправку" }, { status: 409 });
}

/**
 * Удаление снимков кабинета за месяц.
 *
 * Понадобилось после живого сбора 21.08: профиль Ozon был авторизован под одним
 * кабинетом, а снимки ушли ещё и под именем второго — 9 чужих строк. Сбор такое
 * больше не допускает (сверка активного кабинета по куке), но уже принятые
 * снимки убрать было нечем, а держать чужие выплаты в предложениях календаря
 * нельзя. Доступ — как у остальных денежных действий: director/finance.
 */
export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const marketplace = request.nextUrl.searchParams.get("marketplace");
  const cabinetId = String(request.nextUrl.searchParams.get("cabinet") ?? "");
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2025 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || !(marketplace === "wb" || marketplace === "ozon") || !cabinetId) {
    return NextResponse.json({ error: "Некорректный кабинет, маркетплейс или год" }, { status: 400 });
  }
  const session = await getServerSession();
  if (!sessionHasCabinetAccess(session, cabinetId)) return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База данных не настроена" }, { status: 503 });
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await loadPlanningState<Record<string, unknown>>(db, year);
    const store = normalizeBrowserPayoutStore(current.data[STORE_KEY]);
    const kept = store.snapshots.filter((row) => !(row.marketplace === marketplace && row.cabinetId === cabinetId && browserPayoutMonthKey(row) === monthKey));
    const removed = store.snapshots.length - kept.length;
    if (!removed) return NextResponse.json({ ok: true, removed: 0 });
    const result = await writePlanningStateSnapshot(db, year, current, {
      ...current.data,
      [STORE_KEY]: { version: 1 as const, snapshots: kept },
    }, new Date().toISOString());
    if (result.ok) return NextResponse.json({ ok: true, removed });
    if (!("conflict" in result) || !result.conflict) return NextResponse.json({ error: "Не удалось удалить снимки выплат" }, { status: 500 });
  }
  return NextResponse.json({ error: "Данные изменились одновременно, повторите удаление" }, { status: 409 });
}
