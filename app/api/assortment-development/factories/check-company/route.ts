import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { runCompanyRisk, runCompanySearch } from "@/lib/assortment/factorySearch";
import { canEditFactories, FACTORY_ONLY_BAGS_WORDS } from "@/lib/assortment/factoryShortlist";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Проверить компанию» (88查) — по кнопке, по одному запросу к 1688 на шаг, только юрлица (у ИП название не храним):
 * - { direction: "bags", step: "search", name } → кандидаты (у юрлиц — название и код, у ИП — только регион и статус; тёзок сверяет
 *   человек по городу) и exactIndex — полное совпадение названия;
 * - { direction: "bags", step: "risk", creditCode, candidate?, factoryId? } → статус, возраст, юрлицо или ИП, капитал, риски по типам и
 *   дата последнего, флаги; с factoryId — сохраняется в запись шорт-листа (без имён и текстов дел).
 * legal_name (законный представитель), тексты дел и адрес дальше района не читаются вовсе. Закупщик и директор.
 */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const session = await getServerSession();
  if (!canEditFactories(sessionRoles(session))) return NextResponse.json({ error: "Проверять компанию может закупщик или директор" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { direction?: unknown; step?: unknown; name?: unknown; creditCode?: unknown; candidate?: unknown; factoryId?: unknown } | null;
  if (parseDirection(typeof body?.direction === "string" ? body.direction : null) !== "bags") return NextResponse.json({ error: FACTORY_ONLY_BAGS_WORDS }, { status: 400 });
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    if (body?.step === "search") {
      const result = await runCompanySearch(db, { name: body.name, who });
      return NextResponse.json(result, { status: result.refused === "bad_input" || result.refused === "not_company" ? 400 : 200, headers: NO_STORE });
    }
    if (body?.step === "risk") {
      const factoryId = typeof body.factoryId === "string" && UUID_RE.test(body.factoryId) ? body.factoryId : null;
      if (body.factoryId != null && !factoryId) return NextResponse.json({ error: "Неверная запись шорт-листа" }, { status: 400 });
      const result = await runCompanyRisk(db, { creditCode: body.creditCode, candidate: body.candidate, factoryId, who });
      if (result.savedTo) await audit(request, session, { action: "assortment.update", subject: `cn-factory:${result.savedTo}`, after: { registryCheck: result.facts?.checkedOn ?? null } });
      return NextResponse.json(result, { status: result.refused === "bad_input" || result.refused === "not_company" ? 400 : 200, headers: NO_STORE });
    }
    return NextResponse.json({ error: "step — search или risk" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: `Проверка компании не удалась: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
  }
}
