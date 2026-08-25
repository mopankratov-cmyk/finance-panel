import { listAccessibleEntities, resolveEntity, type EntityCabinetLink } from "@/lib/warehouse/entityAccess";

export type ScopeResult =
  | { ok: true; cabinets: EntityCabinetLink[]; entityName: string | null }
  | { ok: false; error: string; status: number };

/**
 * Кабинеты Wildberries, по которым идёт сбор кодов.
 *
 * С юрлицом — только его кабинеты: человек смотрит на числа одного юрлица, и
 * отчёт «добавлено столько-то» рядом с ними обязан говорить о том же. Заодно
 * это бережёт лимиты WB: раньше кнопка обходила все четыре кабинета, даже если
 * интересовал один.
 *
 * Без юрлица — все доступные: так работает ночной прогон, которому надо собрать
 * реестр целиком.
 */
export async function wbCabinetsForScope(entityId: string | null): Promise<ScopeResult> {
  if (entityId) {
    const scope = await resolveEntity(entityId);
    if (!scope.ok) return { ok: false, error: scope.error, status: scope.status };
    return {
      ok: true,
      cabinets: scope.entity.cabinets.filter((link) => link.marketplace === "wb"),
      entityName: scope.entity.name,
    };
  }
  const list = await listAccessibleEntities();
  if (!list.ok) return { ok: false, error: list.error, status: list.status };
  const unique = new Map<string, EntityCabinetLink>();
  for (const entity of list.rows) {
    for (const link of entity.cabinets) {
      if (link.marketplace === "wb") unique.set(link.cabinetId, link);
    }
  }
  return { ok: true, cabinets: [...unique.values()], entityName: null };
}
