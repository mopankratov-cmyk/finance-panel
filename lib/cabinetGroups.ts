import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";

export interface CabinetSelection {
  /** один кабинет — существующее поведение (uuid | null) */
  single: string | null;
  /** несколько кабинетов группы — новое; null если не группа */
  members: string[] | null;
}

// ?cabinet=<uuid> → {single}; ?cabinet=group:<id> → {members}; иначе {single:null, members:null} (все).
export async function resolveCabinetSelection(raw: string | null): Promise<CabinetSelection> {
  if (raw?.startsWith("group:")) {
    const groupId = Number(raw.slice("group:".length));
    if (Number.isFinite(groupId)) {
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.from("cabinet_groups").select("member_ids").eq("id", groupId).maybeSingle();
        const members = (data?.member_ids as string[] | undefined) ?? [];
        if (members.length) return { single: null, members };
      }
    }
    return { single: null, members: null };
  }
  return { single: cabinetIdFromParam(raw), members: null };
}
