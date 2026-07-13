import type { MoySkladAssortment, MoySkladMeta } from "@/lib/moysklad/api";
import type { TaraLine } from "@/lib/supplies/tara";
import type { DistributionWarehouseShare } from "@/lib/supplies/distribution";

export interface WmsMappedLine { line: TaraLine; assortment: MoySkladAssortment }
export interface WmsOrderPlan {
  warehouse: string;
  syncId: string;
  containers: string[];
  totalQuantity: number;
  positions: { nmId: number | null; article: string; barcode: string; quantity: number; assortment: MoySkladMeta }[];
}

interface Container {
  name: string;
  quantity: number;
  lines: WmsMappedLine[];
}

export function restrictTaraLines(lines: TaraLine[], allowedNmIds: Set<number> | null, articleToNmId: Map<string, number> = new Map()) {
  if (allowedNmIds === null) return { lines, blocked: 0, unresolved: 0 };
  const allowed: TaraLine[] = [];
  let blocked = 0;
  let unresolved = 0;
  for (const line of lines) {
    const nmId = line.nmId ?? articleToNmId.get(line.article.trim().toLocaleLowerCase("ru-RU")) ?? null;
    if (nmId === null) { unresolved++; continue; }
    if (!allowedNmIds.has(nmId)) { blocked++; continue; }
    allowed.push({ ...line, nmId });
  }
  return { lines: allowed, blocked, unresolved };
}

export function allocateWholeContainers(mapped: WmsMappedLine[], warehouses: DistributionWarehouseShare[], excludedNmIds: Set<number>, syncIds: string[]) {
  const byContainer = new Map<string, Container>();
  for (const row of mapped) {
    const current = byContainer.get(row.line.container) ?? { name: row.line.container, quantity: 0, lines: [] };
    current.quantity += row.line.quantity;
    current.lines.push(row);
    byContainer.set(row.line.container, current);
  }
  const excluded: string[] = [];
  const containers = [...byContainer.values()].filter((container) => {
    const blocked = container.lines.some(({ line }) => line.nmId !== null && excludedNmIds.has(line.nmId));
    if (blocked) excluded.push(container.name);
    return !blocked;
  }).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "ru"));
  const total = containers.reduce((sum, container) => sum + container.quantity, 0);
  const targets = warehouses.map((warehouse) => total * warehouse.pct / 100);
  const assigned = warehouses.map(() => 0);
  const buckets = warehouses.map(() => [] as Container[]);
  for (const container of containers) {
    let winner = 0;
    for (let index = 1; index < warehouses.length; index++) {
      const deficit = targets[index] - assigned[index];
      const bestDeficit = targets[winner] - assigned[winner];
      if (deficit > bestDeficit + 1e-9 || (Math.abs(deficit - bestDeficit) < 1e-9 && assigned[index] < assigned[winner])) winner = index;
    }
    buckets[winner].push(container);
    assigned[winner] += container.quantity;
  }

  const orders: WmsOrderPlan[] = warehouses.map((warehouse, index) => {
    const positions = new Map<string, WmsOrderPlan["positions"][number]>();
    for (const container of buckets[index]) {
      for (const row of container.lines) {
        const key = row.assortment.meta.href;
        const current = positions.get(key);
        if (current) current.quantity += row.line.quantity;
        else positions.set(key, { nmId: row.line.nmId, article: row.line.article, barcode: row.line.barcode, quantity: row.line.quantity, assortment: row.assortment.meta });
      }
    }
    return { warehouse: warehouse.name, syncId: syncIds[index], containers: buckets[index].map((container) => container.name), totalQuantity: assigned[index], positions: [...positions.values()] };
  }).filter((order) => order.totalQuantity > 0);
  return { orders, excludedContainers: excluded, totalQuantity: total };
}
