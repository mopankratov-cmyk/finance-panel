// Условное форматирование (heat-map, пороги в стиле infernoff — сверено вживую аудитом
// дизайна 2026-07-07: жёлтый ~amber-200, тёмно-зелёный — приглушённый teal-green, ближе к
// emerald-500, чем к чистому green-500).
export const HEAT = { dg: "#10b981", g: "#86efac", y: "#fde68a", r: "#fca5a5" };

export function heat(field: string, v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "";
  switch (field) {
    case "drr": // ниже — лучше
      if (v <= 0) return ""; if (v < 10) return HEAT.dg; if (v < 20) return HEAT.g; if (v < 30) return HEAT.y; return HEAT.r;
    case "margin": // чистая маржа (после ДРР+налог)
      if (v < 0) return HEAT.r; if (v < 10) return HEAT.y; if (v < 25) return HEAT.g; return HEAT.dg;
    case "cr_cart": // показы(охват)→корзина на Ozon мал по природе
      if (v <= 0) return ""; if (v < 0.3) return HEAT.r; if (v < 0.8) return HEAT.y; if (v < 1.5) return HEAT.g; return HEAT.dg;
    case "cr_order":
      if (v <= 0) return ""; if (v < 5) return HEAT.r; if (v < 15) return HEAT.y; if (v < 30) return HEAT.g; return HEAT.dg;
    default: return "";
  }
}
