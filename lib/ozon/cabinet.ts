import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import type { OzonCreds } from "@/lib/ozon/api";

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

interface OzonCabinetRow {
  id: string;
  name: string;
  client_id: string;
  token: string;
  perf_client_id: string | null;
  perf_secret: string | null;
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
export async function getOzonCabinetScope(requested?: string | null): Promise<
  { ok: true; scope: OzonCabinetScope } | { ok: false; error: string }
> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };

  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name, client_id, token, perf_client_id, perf_secret")
    .eq("marketplace", "ozon")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const session = await getServerSession();
  const allowedIds = session?.role === "manager" && session.cabinet_ids.length
    ? new Set(session.cabinet_ids)
    : null;
  const cabinets = ((data ?? []) as OzonCabinetRow[])
    .filter((row) => row.client_id && row.token && (!allowedIds || allowedIds.has(row.id)))
    .map((row) => ({
      id: row.id,
      name: row.name,
      clientId: row.client_id,
      creds: { clientId: row.client_id, apiKey: row.token },
      perf: row.perf_client_id && row.perf_secret
        ? { clientId: row.perf_client_id, secret: row.perf_secret }
        : null,
    }));

  let groupMemberIds: string[] = [];
  let groupName = "Группа кабинетов";
  if (requested?.startsWith("group:")) {
    const groupId = Number(requested.slice("group:".length));
    if (!Number.isInteger(groupId) || groupId <= 0) return { ok: false, error: "Некорректная группа кабинетов" };
    const { data: group, error: groupError } = await db
      .from("cabinet_groups")
      .select("name, member_ids")
      .eq("id", groupId)
      .eq("marketplace", "ozon")
      .maybeSingle();
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

// Креды активного Ozon-кабинета из БД (общий для всех Ozon-эндпоинтов).
export async function getActiveOzonCreds(cabinetId?: string | null): Promise<
  { ok: true; creds: OzonCreds; name: string; perf: { clientId: string; secret: string } | null } | { ok: false; error: string }
> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const session = await getServerSession();
  if (session?.role === "manager" && session.cabinet_ids.length > 0 && (!cabinetId || !session.cabinet_ids.includes(cabinetId))) {
    return { ok: false, error: "Нет доступа к Ozon-кабинету" };
  }
  let q = db.from("wb_cabinets").select("id, name, client_id, token, perf_client_id, perf_secret").eq("marketplace", "ozon").eq("is_active", true);
  if (cabinetId) q = q.eq("id", cabinetId);
  const { data } = await q.limit(1);
  const cab = data?.[0];
  if (!cab?.client_id || !cab?.token) return { ok: false, error: "Нет подключённого Ozon-кабинета" };
  const perf = cab.perf_client_id && cab.perf_secret ? { clientId: cab.perf_client_id as string, secret: cab.perf_secret as string } : null;
  return { ok: true, creds: { clientId: cab.client_id as string, apiKey: cab.token as string }, name: cab.name as string, perf };
}
