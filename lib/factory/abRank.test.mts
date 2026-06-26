// Юнит-тест A/B-ранжирования. Запуск: npx tsx lib/factory/abRank.test.mts
import { variantScore, rankVariants, type VariantMetric } from "./abRank";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) { pass++; } else { fail++; console.error("✗", m); } }
function eq(a: unknown, b: unknown, m: string) { ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)})`); }

const m = (recipe_id: number, views: number, watch_rate?: number, ctr_card?: number): VariantMetric => ({ recipe_id, views, watch_rate, ctr_card });

// ── variantScore: охват × (1 + удержание + 0.5·CTR), нормализация %→доля ──
{
  eq(variantScore(m(1, 1000)), 1000, "score без метрик = views");
  eq(variantScore(m(1, 1000, 0.5)), 1500, "watch_rate 0.5 (доля) → ×1.5");
  eq(variantScore(m(1, 1000, 50)), 1500, "watch_rate 50 (%) нормализуется к 0.5");
  eq(variantScore(m(1, 1000, 0.5, 0.2)), 1600, "ctr 0.2 → +0.5·0.2·1000 = +100");
  eq(variantScore(m(1, 1000, 999)), 2000, "watch_rate клампится к 1 (×2 макс)");
  eq(variantScore({ recipe_id: 1, views: -5 }), 0, "негативные views → 0");
}

// ── rankVariants: винеры/лузеры по портфелю ──
{
  // явный выброс-винер + хвост лузеров
  const rows = [
    m(1, 100000, 0.5),   // винер (выброс)
    m(2, 3000, 0.3),
    m(3, 2500, 0.25),
    m(4, 2000, 0.2),
    m(5, 500, 0.1),       // лузер
  ];
  const { ranked, summary } = rankVariants(rows);
  eq(ranked[0].recipe_id, 1, "топ-1 — выброс (recipe 1)");
  eq(ranked[0].tier, "winner", "выброс помечен winner");
  ok(summary.winners >= 1, "есть хотя бы 1 винер");
  ok(summary.losers >= 1, "есть хотя бы 1 лузер");
  eq(ranked[ranked.length - 1].recipe_id, 5, "низ ранга — recipe 5");
  eq(ranked[ranked.length - 1].tier, "loser", "худший помечен loser");
  // ранги 1..N последовательны
  eq(ranked.map((r) => r.rank), [1, 2, 3, 4, 5], "ранги 1..5");
}

// ── edge: N=1 → mid (нельзя ранжировать) ──
{
  const { ranked, summary } = rankVariants([m(1, 5000, 0.4)]);
  eq(ranked[0].tier, "mid", "N=1 → mid");
  eq(summary, { winners: 0, mid: 1, losers: 0, total: 1 }, "N=1 summary");
}

// ── edge: пусто ──
{
  const { ranked, summary, medianScore } = rankVariants([]);
  eq(ranked, [], "пусто → []");
  eq(medianScore, 0, "median пустого = 0");
  eq(summary.total, 0, "total 0");
}

// ── плоский набор (все равны) → никого не короновать винером ложно ──
{
  const flat = [m(1, 1000, 0.2), m(2, 1000, 0.2), m(3, 1000, 0.2)];
  const { ranked } = rankVariants(flat);
  // score==median у всех → винер требует score>median (строго), значит winner быть не должно
  eq(ranked.filter((r) => r.tier === "winner").length, 0, "плоский набор: ложных винеров нет");
}

console.log(`\nabRank: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
