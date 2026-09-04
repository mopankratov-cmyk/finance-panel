import { sessionHasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface EntityCabinetLink {
  cabinetId: string;
  cabinetName: string;
  relation: "own" | "agent";
  /** Маркетплейс кабинета. Склад работает с обоими, но всё, что читает карточки
   *  через Content API Wildberries, обязано отсеять чужие: в `wb_cabinets` лежат
   *  и кабинеты Ozon, и их ключ — от совсем другого API. */
  marketplace: "wb" | "ozon";
}

export interface LegalEntityRow {
  id: string;
  name: string;
  inn: string | null;
  kind: "ip" | "ooo";
  isActive: boolean;
  note: string | null;
  cabinets: EntityCabinetLink[];
}

/** Юрлицо не имеет собственной модели прав: доступ к нему = доступ хотя бы к одному
 *  его кабинету. Юрлицо без кабинетов (есть счёт, но кабинет не подключён) видно
 *  всем, кроме внешнего селлера: тому открыт только его собственный кабинет. */
export type EntityListResult =
  | { ok: true; rows: LegalEntityRow[] }
  | { ok: false; error: string; status: number };

export type EntityResult =
  | { ok: true; entity: LegalEntityRow }
  | { ok: false; error: string; status: number };

export async function listAccessibleEntities(): Promise<EntityListResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен", status: 500 };

  const entitiesResult = await db
    .from("legal_entities")
    .select("id, name, inn, kind, is_active, note")
    .eq("is_active", true)
    .order("name");
  if (entitiesResult.error) {
    const missing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(entitiesResult.error.code ?? "");
    return {
      ok: false,
      error: missing ? "Примените миграцию 202608230004_legal_entities.sql" : entitiesResult.error.message,
      status: missing ? 503 : 500,
    };
  }

  // Порядок задаём явно: от него зависят умолчания в потребителях (какой кабинет
  // подставится в приёмку), а порядок строк из базы ничем не гарантирован.
  const linksResult = await db
    .from("legal_entity_cabinets")
    .select("legal_entity_id, cabinet_id, relation")
    .order("relation")
    .order("cabinet_id");
  if (linksResult.error) return { ok: false, error: linksResult.error.message, status: 500 };

  // Имена кабинетов отдаются отсюда же: оператору склада незачем открывать
  // кабинетный API, где живут маскированные токены.
  const cabinetIds = [...new Set((linksResult.data ?? []).map((link) => String(link.cabinet_id)))];
  const cabinetInfo = new Map<string, { name: string; marketplace: "wb" | "ozon" }>();
  if (cabinetIds.length > 0) {
    const named = await db.from("wb_cabinets").select("id, name, marketplace").in("id", cabinetIds);
    for (const row of named.data ?? []) {
      cabinetInfo.set(String(row.id), {
        name: String(row.name ?? ""),
        marketplace: row.marketplace === "ozon" ? "ozon" : "wb",
      });
    }
  }

  const byEntity = new Map<string, EntityCabinetLink[]>();
  for (const link of linksResult.data ?? []) {
    const list = byEntity.get(String(link.legal_entity_id)) ?? [];
    const info = cabinetInfo.get(String(link.cabinet_id));
    list.push({
      cabinetId: String(link.cabinet_id),
      cabinetName: info?.name ?? "кабинет",
      relation: link.relation === "agent" ? "agent" : "own",
      marketplace: info?.marketplace ?? "wb",
    });
    byEntity.set(String(link.legal_entity_id), list);
  }

  // Права считаются по одной прочитанной сессии, а не запросом на каждый кабинет:
  // раньше на девять юрлиц набегал десяток обращений к базе, и экран ждал секунды.
  const session = await getServerSession();
  // Внешнему селлеру доступен только его собственный кабинет, и это единственный
  // случай, где нужна проверка владельца кабинета — одним запросом на все сразу.
  let sellerCabinets: Set<string> | null = null;
  if (session?.role === "seller") {
    const ids = [...new Set((linksResult.data ?? []).map((link) => String(link.cabinet_id)))];
    if (ids.length === 0 || !session.organization_id) {
      sellerCabinets = new Set();
    } else {
      const owned = await db
        .from("wb_cabinets")
        .select("id")
        .in("id", ids)
        .eq("marketplace", "wb")
        .eq("organization_id", session.organization_id);
      sellerCabinets = new Set((owned.data ?? []).map((row) => String(row.id)));
    }
  }

  const rows: LegalEntityRow[] = [];
  for (const raw of entitiesResult.data ?? []) {
    const cabinets = (byEntity.get(String(raw.id)) ?? []).slice().sort((a, b) =>
      // Свои раньше агентских, Wildberries раньше Ozon, дальше по имени: список
      // кабинетов не должен переставляться от запроса к запросу.
      Number(a.relation === "agent") - Number(b.relation === "agent")
      || Number(a.marketplace === "ozon") - Number(b.marketplace === "ozon")
      || a.cabinetName.localeCompare(b.cabinetName, "ru"));
    const canSee = (cabinetId: string | null) =>
      sessionHasCabinetAccess(session, cabinetId)
      && (sellerCabinets === null || (cabinetId !== null && sellerCabinets.has(cabinetId)));
    // Внешней компании юрлицо открывает только СВОЯ связь: агентская означает
    // «чужой товар продаётся через мой кабинет», и она не должна открывать
    // чужое юрлицо целиком — со складом, себестоимостью и документами.
    const opening = sellerCabinets === null ? cabinets : cabinets.filter((link) => link.relation === "own");
    const allowed = cabinets.length === 0
      ? canSee(null)
      : opening.some((link) => canSee(link.cabinetId));
    if (!allowed) continue;
    rows.push({
      id: String(raw.id),
      name: String(raw.name),
      inn: raw.inn as string | null,
      kind: raw.kind === "ooo" ? "ooo" : "ip",
      isActive: Boolean(raw.is_active),
      note: raw.note as string | null,
      // В строке юрлица приезжают его кабинеты — их имена видны на экранах
      // отгрузки и возврата. Внешней компании показываем только её собственные:
      // остальные принадлежат другой организации.
      cabinets: sellerCabinets === null ? cabinets : cabinets.filter((link) => sellerCabinets.has(link.cabinetId)),
    });
  }

  return { ok: true, rows };
}

/** Проверка доступа к одному юрлицу + его кабинеты (нужны, чтобы собрать приёмки). */
export async function resolveEntity(entityId: string | null): Promise<EntityResult> {
  if (!entityId) return { ok: false, error: "Выберите юрлицо", status: 400 };
  const list = await listAccessibleEntities();
  if (!list.ok) return { ok: false, error: list.error, status: list.status };
  const entity = list.rows.find((row) => row.id === entityId);
  if (!entity) return { ok: false, error: "Нет доступа к юрлицу", status: 403 };
  return { ok: true, entity };
}
