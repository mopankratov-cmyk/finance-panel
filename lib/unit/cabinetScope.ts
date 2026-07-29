const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnitCabinetScope =
  | { aggregate: true; rawCabinet: null }
  | { aggregate: false; rawCabinet: string };

export function parseUnitCabinetScope(raw: string | null): UnitCabinetScope {
  if (raw === null || raw === "all") return { aggregate: true, rawCabinet: null };
  if (!UUID.test(raw)) throw new Error("Некорректный кабинет");
  return { aggregate: false, rawCabinet: raw };
}
