import type { Session } from "@/lib/auth/session";
import { isCabinetScopedRole } from "@/lib/auth/roles";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CabinetGroupRow {
  id: number;
  name: string;
  marketplace: string;
  member_ids: unknown;
}

export interface SafeCabinetGroup {
  id: number;
  name: string;
  marketplace: string;
  memberIds: string[];
}

export function shouldShowCabinetSwitcher(cabinetCount: number, groupCount: number): boolean {
  return cabinetCount > 0 || groupCount > 0;
}

export function filterCabinetGroups(
  rows: CabinetGroupRow[],
  session: Pick<Session, "role" | "cabinet_ids">,
): SafeCabinetGroup[] {
  const allowed = new Set(session.cabinet_ids.map((id) => id.toLowerCase()));
  const result: SafeCabinetGroup[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.member_ids)) continue;
    const validMembers = row.member_ids
      .filter((id): id is string => typeof id === "string" && UUID.test(id));
    if (validMembers.length !== row.member_ids.length) continue;
    const members = [...new Set(validMembers.map((id) => id.toLowerCase()))].sort();
    if (members.length === 0) continue;
    if (isCabinetScopedRole(session.role) && members.some((id) => !allowed.has(id))) continue;
    result.push({ id: row.id, name: row.name, marketplace: row.marketplace, memberIds: members });
  }
  return result;
}
