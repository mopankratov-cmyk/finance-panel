import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import type { OzonCreds } from "@/lib/ozon/api";
import { isCabinetScopedRole } from "@/lib/auth/roles";

export interface OzonCabinetAccess {
  id: string;
  name: string;
  clientId: string;
  creds: OzonCreds;
  perf: { clientId: string; secret: string } | null;
}

export interface OzonCabinetScope {
  mode: "single" | "all" | "group";
  label: string;
  cabinets: OzonCabinetAccess[];
}

export interface OzonCabinetScopeDescriptor {
  mode: OzonCabinetScope["mode"];
  label: string;
  cabinetIds: string[];
}

interface OzonCabinetRow {
  id: string;
  name: string;
  client_id: string;
  token: string;
  perf_client_id: string | null;
  perf_secret: string | null;
}

export function applyOzonQuerySignal<T extends { abortSignal(signal: AbortSignal): T }>(
  query: T,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  return signal ? query.abortSignal(signal) : query;
}

function cabinetAccess(row: OzonCabinetRow): OzonCabinetAccess {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    creds: { clientId: row.client_id, apiKey: row.token },
    perf: row.perf_client_id && row.perf_secret
      ? { clientId: row.perf_client_id, secret: row.perf_secret }
      : null,
  };
}

export function describeOzonScope(scope: OzonCabinetScope): OzonCabinetScopeDescriptor {
  return {
    mode: scope.mode,
    label: scope.label,
    cabinetIds: scope.cabinets.map((cabinet) => cabinet.id).sort(),
  };
}

/** Pure scope selection used by the server resolver and regression tests. */
export function selectOzonCabinets(
  cabinets: OzonCabinetAccess[],
  requested: string | null | undefined,
  groupMemberIds: string[] = [],
): OzonCabinetScope | null {
  if (!cabinets.length) return null;
  if (requested === "all") return { mode: "all", label: "Все кабинеты", cabinets };
  if (requested?.startsWith("group:")) {
    const members = new Set(groupMemberIds);
    const selected = cabinets.filter((cabinet) => members.has(cabinet.id));
    return selected.length ? { mode: "group", label: "Группа кабинетов", cabinets: selected } : null;
  }
  const selected = requested ? cabinets.find((cabinet) => cabinet.id === requested) : cabinets[0];
  return selected ? { mode: "single", label: selected.name, cabinets: [selected] } : null;
}

// Разрешает один кабинет, агрегат «все» или сохранённую группу. В отличие от старого
// getActiveOzonCreds, агрегат никогда не маскируется под первый кабинет.
export async function getOzonCabinetScope(
  requested?: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<
  { ok: true; scope: OzonCabinetScope } | { ok: false; error: string }
> {
  options.signal?.throwIfAborted();
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };

  let cabinetQuery = db
    .from("wb_cabinets")
    .select("id, name, client_id, token, perf_client_id, perf_secret")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  cabinetQuery = applyOzonQuerySignal(cabinetQuery, options.signal);
  const { data, error } = await cabinetQuery;
  if (error) return { ok: false, error: error.message };

  const session = await getServerSession();
  const allowedIds = session && isCabinetScopedRole(session.role) && session.cabinet_ids.length
    ? new Set(session.cabinet_ids)
    : null;
  const cabinets = ((data ?? []) as OzonCabinetRow[])
    .filter((row) => row.client_id && row.token && (!allowedIds || allowedIds.has(row.id)))
    .map(cabinetAccess);

  let groupMemberIds: string[] = [];
  let groupName = "Группа кабинетов";
  if (requested?.startsWith("group:")) {
    options.signal?.throwIfAborted();
    const groupId = Number(requested.slice("group:".length));
    if (!Number.isInteger(groupId) || groupId <= 0) return { ok: false, error: "Некорректная группа кабинетов" };
    let groupQuery = db
      .from("cabinet_groups")
      .select("name, member_ids")
      .eq("id", groupId)
      .eq("marketplace", "ozon");
    groupQuery = applyOzonQuerySignal(groupQuery, options.signal);
    const { data: group, error: groupError } = await groupQuery.maybeSingle();
    if (groupError) return { ok: false, error: groupError.message };
    if (!group) return { ok: false, error: "Группа Ozon не найдена" };
    groupMemberIds = (group.member_ids as string[] | null) ?? [];
    groupName = String(group.name || groupName);
  }

  const scope = selectOzonCabinets(cabinets, requested, groupMemberIds);
  if (!scope) return { ok: false, error: "Нет доступного Ozon-кабинета" };
  if (scope.mode === "group") scope.label = groupName;
  return { ok: true, scope };
}

// Внутренний резолвер для серверного snapshot-кэша. Дескриптор формируется только
// после пользовательской проверки доступа либо самим защищённым cron-роутом;
// в ключ кэша попадают UUID кабинетов, но никогда API-токены.
export async function resolveOzonScopeDescriptor(
  descriptor: OzonCabinetScopeDescriptor,
): Promise<OzonCabinetScope | null> {
  const cabinetIds = [...new Set(descriptor.cabinetIds)].filter(Boolean).sort();
  if (!cabinetIds.length) return null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, token, perf_client_id, perf_secret")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .in("id", cabinetIds);
  if (error) throw new Error(error.message);
  const byId = new Map(
    ((data ?? []) as OzonCabinetRow[])
      .filter((row) => row.client_id && row.token)
      .map((row) => [row.id, cabinetAccess(row)]),
  );
  const cabinets = cabinetIds.map((id) => byId.get(id)).filter((cabinet): cabinet is OzonCabinetAccess => Boolean(cabinet));
  if (cabinets.length !== cabinetIds.length) return null;
  return { mode: descriptor.mode, label: descriptor.label, cabinets };
}

// Набор представлений, которые cron заранее прогревает: общий, каждый отдельный
// кабинет и сохранённые группы. Если таблицы групп ещё нет, базовые представления
// всё равно прогреваются.
export async function listOzonScopeDescriptors(): Promise<OzonCabinetScopeDescriptor[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const cabinets = (data ?? []).map((row) => ({ id: String(row.id), name: String(row.name || "Ozon") }));
  if (!cabinets.length) return [];
  const activeIds = new Set(cabinets.map((cabinet) => cabinet.id));
  const result: OzonCabinetScopeDescriptor[] = [
    { mode: "all", label: "Все кабинеты", cabinetIds: [...activeIds].sort() },
    ...cabinets.map((cabinet) => ({ mode: "single" as const, label: cabinet.name, cabinetIds: [cabinet.id] })),
  ];
  const groups = await db
    .from("cabinet_groups")
    .select("name, member_ids")
    .eq("marketplace", "ozon")
    .order("id", { ascending: true });
  if (!groups.error) {
    for (const group of groups.data ?? []) {
      const cabinetIds = ((group.member_ids as string[] | null) ?? [])
        .filter((id) => activeIds.has(id))
        .sort();
      if (cabinetIds.length) result.push({ mode: "group", label: String(group.name || "Группа кабинетов"), cabinetIds });
    }
  }
  return result;
}

// Креды активного Ozon-кабинета из БД (общий для всех Ozon-эндпоинтов).
export async function getActiveOzonCreds(cabinetId?: string | null): Promise<
  { ok: true; id: string; creds: OzonCreds; name: string; perf: { clientId: string; secret: string } | null } | { ok: false; error: string }
> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const session = await getServerSession();
  if (session && isCabinetScopedRole(session.role) && session.cabinet_ids.length > 0 && (!cabinetId || !session.cabinet_ids.includes(cabinetId))) {
    return { ok: false, error: "Нет доступа к Ozon-кабинету" };
  }
  let q = db.from("wb_cabinets").select("id, name, client_id, token, perf_client_id, perf_secret").eq("marketplace", "ozon").eq("is_active", true);
  // Агрегат «все кабинеты» конкретным кабинетом не является: без этой проверки
  // сюда уходил фильтр `id = "all"`, строк не находилось, и пользователь видел
  // «Нет подключённого Ozon-кабинета» при живых кабинетах.
  if (cabinetId && cabinetId !== "all") q = q.eq("id", cabinetId);
  // Порядок задаём явно: без него «первый» кабинет зависел от плана запроса и
  // мог меняться между запросами.
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1);
  // Ошибку базы нельзя выдавать за «кабинета нет»: это разные причины, и
  // человеку по ним нужно разное действие.
  if (error) return { ok: false, error: `Кабинеты не прочитаны: ${error.message}` };
  const cab = data?.[0];
  if (!cab?.client_id || !cab?.token) return { ok: false, error: "Нет подключённого Ozon-кабинета" };
  const perf = cab.perf_client_id && cab.perf_secret ? { clientId: cab.perf_client_id as string, secret: cab.perf_secret as string } : null;
  // id нужен для настроек кабинета (налог, комиссия посредника) — они хранятся по нему.
  return { ok: true, id: String(cab.id), creds: { clientId: cab.client_id as string, apiKey: cab.token as string }, name: cab.name as string, perf };
}
