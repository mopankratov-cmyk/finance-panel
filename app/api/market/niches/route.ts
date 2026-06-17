import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { hasMpstats, itemSubject } from "@/lib/mpstats/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Авто-определение ниш (предметов WB), в которых работают наши кабинеты.
// По топ-SKU каждого кабинета берём subject из MPStats items/{nm}/full → агрегат.
// Тяжело (N вызовов) → кэш 24ч в процессе.
let _memo: { ts: number; val: unknown } | null = null;
const TTL = 24 * 3600 * 1000;
const PER_CAB = 12; // топ-SKU на кабинет (бережём квоту)

export async function GET() {
  if (!hasMpstats()) return NextResponse.json({ error: "MPSTATS_TOKEN не настроен" }, { status: 501 });
  if (_memo && Date.now() - _memo.ts < TTL) return NextResponse.json(_memo.val);
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const cabs = await getActiveWbCabinets();
  const subj = new Map<number, { id: number; name: string; sku_count: number; cabinets: Set<string> }>();

  for (const c of cabs) {
    const rep = await db.rpc("rnp_report", { p_cabinet: c.id });
    const top = ((rep.data ?? []) as { nm_id: number; orders_sum_month: number }[])
      .slice()
      .sort((a, b) => Number(b.orders_sum_month ?? 0) - Number(a.orders_sum_month ?? 0))
      .slice(0, PER_CAB)
      .map((r) => r.nm_id);
    const subs = await Promise.all(top.map((nm) => itemSubject(nm)));
    for (const s of subs) {
      if (!s) continue;
      const e = subj.get(s.id) ?? { id: s.id, name: s.name, sku_count: 0, cabinets: new Set<string>() };
      e.sku_count += 1;
      e.cabinets.add(c.name);
      subj.set(s.id, e);
    }
  }

  const niches = [...subj.values()]
    .map((e) => ({ id: e.id, name: e.name, sku_count: e.sku_count, cabinets: [...e.cabinets] }))
    .sort((a, b) => b.sku_count - a.sku_count);

  const payload = { ok: true, niches, count: niches.length };
  if (niches.length) _memo = { ts: Date.now(), val: payload };
  return NextResponse.json(payload);
}
