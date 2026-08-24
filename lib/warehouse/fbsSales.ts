// Какую продажу FBS с какого остатка списывать.
//
// Правило одно и оно неочевидное: владельца определяет ТОВАР, а не кабинет.
// Пеналы ООО РИО продаются через агентский кабинет Оптимы, а своего кабинета у
// РИО нет вовсе — если искать продажи по кабинетам юрлица, продажи РИО не
// найдутся никогда. Поэтому заказы читаются из всех доступных кабинетов, а
// отбираются по владельцу позиции. Кабинет остаётся на движении как канал.
//
// Второе правило — про размер. Баркод сборочного задания называет размер точно.
// Карточка называет только модель, поэтому по ней размер берётся, лишь когда он
// у модели один: молча выбрать любой из пяти значило бы соврать в остатке.

export interface FbsOrder {
  srid: string;
  nmId: number;
  article: string;
  /** ISO-дата заказа. */
  date: string;
  cabinetId: string;
}

export interface VariantRef {
  id: string;
  /** Владелец товара. null — владелец не проставлен, списывать не с чего. */
  entityId: string | null;
}

export interface FbsSaleLine {
  srid: string;
  variantId: string;
  cabinetId: string;
  qty: number;
  occurredAt: string;
}

export interface FbsMatchInput {
  orders: FbsOrder[];
  /** Баркод по srid — из сборочных заданий. */
  barcodeBySrid: Map<string, string>;
  variantByBarcode: Map<string, VariantRef>;
  /** Все варианты карточки: размер по ней берём только если он единственный. */
  variantsByNmId: Map<number, VariantRef[]>;
  entityId: string;
  /** Раньше этой даты остатку склада верить нельзя — продажи не списываем. */
  since: string;
}

export interface FbsMatchResult {
  lines: FbsSaleLine[];
  /** Заказы чужих юрлиц: спишутся при синхронизации своего. */
  otherEntity: number;
  /** Заказы, по которым размер определить нельзя, — по артикулам. */
  unresolved: { article: string; count: number }[];
}

export function matchFbsSales(input: FbsMatchInput): FbsMatchResult {
  const lines: FbsSaleLine[] = [];
  const unresolved = new Map<string, number>();
  let otherEntity = 0;

  for (const order of input.orders) {
    if (!order.srid || order.date < input.since) continue;

    const barcode = input.barcodeBySrid.get(order.srid);
    const fromBarcode = barcode ? input.variantByBarcode.get(barcode) : undefined;
    const byCard = input.variantsByNmId.get(order.nmId);
    const variant = fromBarcode ?? (byCard && byCard.length === 1 ? byCard[0] : undefined);

    if (!variant) {
      const key = order.article || String(order.nmId);
      unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
      continue;
    }
    // Товар без владельца списывать не с чего: неизвестно, чей остаток трогать.
    if (variant.entityId !== input.entityId) {
      if (variant.entityId) otherEntity += 1;
      else {
        const key = order.article || String(order.nmId);
        unresolved.set(key, (unresolved.get(key) ?? 0) + 1);
      }
      continue;
    }

    lines.push({
      srid: order.srid,
      variantId: variant.id,
      cabinetId: order.cabinetId,
      qty: 1,
      occurredAt: order.date,
    });
  }

  return {
    lines,
    otherEntity,
    unresolved: [...unresolved.entries()]
      .map(([article, count]) => ({ article, count }))
      .sort((a, b) => b.count - a.count),
  };
}
