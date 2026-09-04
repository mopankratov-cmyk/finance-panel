import { notFound } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { PrintableDiscrepancy, type DiscrepancyLine } from "@/components/warehouse/PrintableDiscrepancy";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { listAccessibleEntities } from "@/lib/warehouse/entityAccess";

export const dynamic = "force-dynamic";

/**
 * Акт расхождений по партии приёмки.
 *
 * Читает партию, а не документ регистра: расхождение — это разница между тем,
 * что ждали, и тем, что приняли, и живёт она в строках приёмки. На остатке её
 * уже нет — туда попадает только принятое.
 */
export default async function Page({ params }: { params: Promise<{ batch: string }> }) {
  const { batch } = await params;
  // Без сессии listAccessibleEntities считает вызов машинным и отдаёт все
  // юрлица: печатная форма по прямой ссылке показала бы чужой документ.
  const session = await getServerSession();
  if (!session) notFound();
  const list = await listAccessibleEntities();
  const db = getSupabaseAdmin();
  if (!list.ok || !db) notFound();

  const receipts = await db
    .from("purchase_receipts")
    .select("id, cabinet_id, product_id, variant_id, nm_id, article, expected_qty, received_qty, defect_qty, expected_at, received_at, warehouse_id, note, created_by")
    .eq("batch_id", batch)
    .order("id");
  const rows = receipts.data ?? [];
  if (rows.length === 0) notFound();

  // Партия принадлежит кабинету, склад ведётся по юрлицу: сверяем доступ по той
  // же связи, по которой приёмка вообще попадает в модуль.
  const cabinetId = String(rows[0].cabinet_id);
  const entity = list.rows.find((row) => row.cabinets.some((link) => link.cabinetId === cabinetId && link.relation === "own"));
  if (!entity) notFound();

  const variantIds = [...new Set(rows.map((row) => row.variant_id).filter(Boolean).map(String))];
  const [variantsResult, warehousesResult] = await Promise.all([
    variantIds.length === 0
      ? Promise.resolve({ data: [] })
      : db.from("product_variants").select("id, size_label, barcode").in("id", variantIds),
    db.from("warehouses").select("id, name"),
  ]);
  const variants = new Map(((variantsResult.data ?? []) as { id: string; size_label: string | null; barcode: string | null }[])
    .map((row) => [String(row.id), row]));
  const names = new Map(((warehousesResult.data ?? []) as { id: string; name: string }[])
    .map((row) => [String(row.id), String(row.name)]));

  const lines: DiscrepancyLine[] = rows.map((row) => {
    const variant = row.variant_id ? variants.get(String(row.variant_id)) : undefined;
    return {
      article: String(row.article ?? ""),
      sizeLabel: String(variant?.size_label ?? ""),
      nmId: row.nm_id === null ? null : Number(row.nm_id),
      barcode: variant?.barcode ?? null,
      expectedQty: Number(row.expected_qty ?? 0),
      receivedQty: Number(row.received_qty ?? 0),
      defectQty: Number(row.defect_qty ?? 0),
    };
  });

  const receivedAt = rows.map((row) => row.received_at).filter(Boolean).map(String).sort().pop() ?? null;
  const warehouseId = rows.map((row) => row.warehouse_id).filter(Boolean).map(String)[0] ?? null;

  return (
    <PrintableDiscrepancy
      doc={{
        batchId: batch,
        entityName: entity.name,
        entityInn: entity.inn,
        warehouseName: warehouseId ? names.get(warehouseId) ?? null : null,
        expectedAt: rows[0].expected_at ? String(rows[0].expected_at) : null,
        receivedAt,
        note: rows[0].note ? String(rows[0].note) : null,
        createdBy: rows[0].created_by ? String(rows[0].created_by) : null,
        lines,
      }}
    />
  );
}
