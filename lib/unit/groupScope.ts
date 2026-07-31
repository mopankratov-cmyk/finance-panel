import type { Session } from "@/lib/auth/session";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP = /^group:([1-9]\d*)$/;
export const MAX_GROUP_MEMBERS = 3;

export type UnitResolvedScope =
  | { mode: "all"; scopeKey: "all" }
  | { mode: "single"; cabinetId: string; scopeKey: string }
  | { mode: "group"; members: string[]; scopeKey: string };

interface QueryResult<T> {
  data: T | null;
  error: unknown;
}

interface CabinetRow {
  id: string;
  marketplace: string;
  is_active: boolean;
}

interface GroupRow {
  id: number;
  marketplace: string;
  member_ids: unknown;
}

export interface UnitScopeQueries {
  group(id: number): Promise<QueryResult<GroupRow>>;
  cabinets(ids: string[]): Promise<QueryResult<CabinetRow[]>>;
  authorizeMembers?(members: string[]): void;
}

export class UnitScopeError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409 | 422 | 503, message: string) {
    super(message);
    this.name = "UnitScopeError";
  }
}

export function parseUnitCabinetQuery(searchParams: URLSearchParams): string | null {
  const values = searchParams.getAll("cabinet");
  if (values.length > 1) throw new UnitScopeError(400, "Параметр cabinet должен быть указан один раз");
  const raw = values[0];
  if (raw == null || raw === "" || raw === "all") return null;
  if (UUID.test(raw)) return raw.toLowerCase();
  const group = GROUP.exec(raw);
  if (group && Number.isSafeInteger(Number(group[1]))) return raw;
  throw new UnitScopeError(400, "Некорректный кабинет");
}

function canonicalMembers(values: unknown): string[] {
  if (!Array.isArray(values)) throw new UnitScopeError(409, "Состав группы устарел");
  const validValues = values.filter((value): value is string =>
    typeof value === "string" && UUID.test(value));
  if (validValues.length !== values.length) {
    throw new UnitScopeError(409, "Состав группы устарел");
  }
  const members = [...new Set(validValues.map((value) => value.toLowerCase()))].sort();
  if (members.length === 0) throw new UnitScopeError(409, "Состав группы устарел");
  if (members.length > MAX_GROUP_MEMBERS) {
    throw new UnitScopeError(422, "Группа содержит слишком много кабинетов");
  }
  return members;
}

export function canonicalGroupScopeKey(members: string[]): string {
  const canonical = [...new Set(members.map((member) => member.toLowerCase()))].sort().join("\n");
  return `group:v2:${createHash("sha256").update(canonical).digest("hex")}`;
}

export async function resolveUnitCabinetScope(
  raw: string | null,
  queries: UnitScopeQueries,
): Promise<UnitResolvedScope> {
  if (raw === null) return { mode: "all", scopeKey: "all" };

  const groupMatch = GROUP.exec(raw);
  if (groupMatch) {
    const groupId = Number(groupMatch[1]);
    if (!Number.isSafeInteger(groupId)) throw new UnitScopeError(400, "Некорректный кабинет");
    const group = await queries.group(groupId);
    if (group.error) throw new UnitScopeError(503, "Сервис кабинетов временно недоступен");
    if (!group.data || group.data.marketplace !== "wb") throw new UnitScopeError(404, "Группа не найдена");
    const members = canonicalMembers(group.data.member_ids);
    queries.authorizeMembers?.(members);
    const cabinets = await queries.cabinets(members);
    if (cabinets.error) throw new UnitScopeError(503, "Сервис кабинетов временно недоступен");
    const valid = new Set((cabinets.data ?? [])
      .filter((row) => row.marketplace === "wb" && row.is_active)
      .map((row) => row.id));
    if (valid.size !== members.length || members.some((member) => !valid.has(member))) {
      throw new UnitScopeError(409, "Состав группы содержит недоступный кабинет");
    }
    return { mode: "group", members, scopeKey: canonicalGroupScopeKey(members) };
  }

  const cabinets = await queries.cabinets([raw]);
  if (cabinets.error) throw new UnitScopeError(503, "Сервис кабинетов временно недоступен");
  const exact = (cabinets.data ?? []).find((row) =>
    row.id.toLowerCase() === raw && row.marketplace === "wb" && row.is_active);
  if (!exact) throw new UnitScopeError(404, "Кабинет не найден");
  return { mode: "single", cabinetId: raw, scopeKey: `single:${raw}` };
}

export function assertUnitScopeAccess(
  session: Pick<Session, "role" | "cabinet_ids"> | null,
  scope: UnitResolvedScope,
): void {
  if (!session || (session.role !== "manager" && session.role !== "seller")) return;
  if (scope.mode === "all") throw new UnitScopeError(403, "Нет доступа к кабинетам");
  const members = scope.mode === "single" ? [scope.cabinetId] : scope.members;
  const allowed = new Set(session.cabinet_ids.map((member) => member.toLowerCase()));
  if (members.some((member) => !allowed.has(member.toLowerCase()))) {
    throw new UnitScopeError(403, "Нет доступа ко всем кабинетам группы");
  }
}

export function assertUnitMemberAccess(
  session: Pick<Session, "role" | "cabinet_ids"> | null,
  members: string[],
): void {
  if (!session || (session.role !== "manager" && session.role !== "seller")) return;
  const allowed = new Set(session.cabinet_ids.map((member) => member.toLowerCase()));
  if (members.some((member) => !allowed.has(member.toLowerCase()))) {
    throw new UnitScopeError(403, "Нет доступа ко всем кабинетам группы");
  }
}
