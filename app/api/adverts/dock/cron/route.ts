import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { getAdvertBudget, depositAdvert, startAdvert } from "@/lib/adverts/wbApi";
import { decideDock, type DockConfig } from "@/lib/adverts/docking";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ConfigRow {
  advert_id: number; cabinet: string | null; enabled: boolean;
  hours: number[] | null; amount_rub: number; threshold_rub: number;
}

// GET — крон авто-докидывания (ежечасно). Защита CRON_SECRET. Деньги тратятся только для enabled-РК
// и только по решению decideDock. Глобальный стоп — env ADVERT_DOCKING_OFF=1.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const killSwitch = process.env.ADVERT_DOCKING_OFF === "1";

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const { data: cfgs } = await db
    .from("advert_docking_config")
    .select("advert_id, cabinet, enabled, hours, amount_rub, threshold_rub")
    .eq("enabled", true);
  const configs = (cfgs ?? []) as ConfigRow[];
  if (!configs.length) return NextResponse.json({ ok: true, killSwitch, checked: 0, note: "нет включённых конфигов" });

  const cabs = await getActiveWbCabinets();
  const tokenByCab = new Map<string, string>();
  for (const c of cabs) if (c.token_advert) tokenByCab.set(c.id, c.token_advert);
  const envToken = process.env.WB_TOKEN_ADVERT || "";

  const ids = configs.map((c) => c.advert_id);
  const { data: adv } = await db.from("wb_adverts").select("advert_id, status").in("advert_id", ids);
  const statusById = new Map<number, number>();
  for (const a of (adv ?? []) as { advert_id: number; status: number }[]) statusById.set(a.advert_id, a.status);

  const hourMsk = (new Date().getUTCHours() + 3) % 24;
  const results: Record<string, unknown> = {};
  const logRows: Record<string, unknown>[] = [];

  for (const cfg of configs) {
    const token = (cfg.cabinet && tokenByCab.get(cfg.cabinet)) || envToken;
    if (!token) { results[cfg.advert_id] = { skip: "нет токена рекламы" }; continue; }

    const budget = await getAdvertBudget(token, cfg.advert_id);
    const dc: DockConfig = {
      advertId: cfg.advert_id, enabled: cfg.enabled, hours: cfg.hours ?? [],
      amountRub: Number(cfg.amount_rub), thresholdRub: Number(cfg.threshold_rub),
    };
    const decision = decideDock(dc, { budget, statusId: statusById.get(cfg.advert_id) ?? null, currentHourMsk: hourMsk }, killSwitch);
    if (!decision.deposit && !decision.relaunch) { results[cfg.advert_id] = { skip: decision.reason, budget }; continue; }

    const action: string[] = [];
    let status = "ok", detail = "";
    if (decision.deposit) {
      const r = await depositAdvert(token, cfg.advert_id, decision.amount);
      if (r.ok) action.push("deposit"); else { status = "error"; detail += `deposit: ${r.error}; `; }
    }
    if (decision.relaunch) {
      const r = await startAdvert(token, cfg.advert_id);
      if (r.ok) action.push("relaunch"); else { status = "error"; detail += `start: ${r.error}; `; }
    }
    results[cfg.advert_id] = { budget, decision: decision.reason, action: action.join("+"), status, detail: detail || undefined };
    logRows.push({ advert_id: cfg.advert_id, hour: hourMsk, budget_before: budget, amount: decision.amount, action: action.join("+") || "skip", status, detail: detail || decision.reason });
  }

  if (logRows.length) await db.from("advert_docking_log").insert(logRows);
  return NextResponse.json({ ok: true, killSwitch, hourMsk, checked: configs.length, results });
}
