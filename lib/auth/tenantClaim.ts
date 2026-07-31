import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantClaimResult =
  | { ok: true }
  | { ok: false; status: 409 | 500; error: string };

/**
 * Атомарно резервирует внешний seller_id за одной организацией. Несколько
 * виртуальных кабинетов одного продавца внутри tenant допустимы, между tenant — нет.
 */
export async function claimMarketplaceSeller(
  db: SupabaseClient,
  marketplace: "wb" | "ozon",
  sellerId: string,
  organizationId: string,
): Promise<TenantClaimResult> {
  const normalizedSellerId = sellerId.trim();
  if (!normalizedSellerId || !organizationId) {
    return { ok: false, status: 500, error: "Не удалось определить владельца кабинета" };
  }

  const { error: insertError } = await db
    .from("marketplace_tenant_claims")
    .upsert(
      { marketplace, seller_id: normalizedSellerId, organization_id: organizationId },
      { onConflict: "marketplace,seller_id", ignoreDuplicates: true },
    );
  if (insertError) return { ok: false, status: 500, error: insertError.message };

  const { data: claim, error: claimError } = await db
    .from("marketplace_tenant_claims")
    .select("organization_id")
    .eq("marketplace", marketplace)
    .eq("seller_id", normalizedSellerId)
    .single();
  if (claimError || !claim) {
    return { ok: false, status: 500, error: claimError?.message ?? "Не удалось проверить владельца кабинета" };
  }
  if (String(claim.organization_id) !== organizationId) {
    return { ok: false, status: 409, error: "Этот кабинет уже подключён к другой организации" };
  }
  return { ok: true };
}
