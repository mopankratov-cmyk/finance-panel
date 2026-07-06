import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseReadClient } from "@/lib/supabaseAdmin";
import { mergeDistributionTargetConfig } from "@/lib/factory/distributionTargets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as JsonRecord) } : {};
}

function text(value: unknown, max = 240): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function mode(value: unknown): "organic" | "paid" | "manual" {
  const cleaned = text(value, 40)?.toLowerCase();
  return cleaned === "paid" || cleaned === "manual" ? cleaned : "organic";
}

function normalizePlatform(value: unknown): string | null {
  const cleaned = text(value, 80)?.toLowerCase();
  return cleaned || null;
}

export async function GET() {
  const db = getSupabaseReadClient();
  if (!db) return NextResponse.json({ ok: false, configured: false, error: "Supabase не настроен" }, { status: 500 });

  const { data, error } = await db
    .from("factory_distribution_targets")
    .select("id,platform,account_ref,mode,config,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, targets: data || [] });
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({
      ok: false,
      error: "write-path недоступен: нужен SUPABASE_SERVICE_ROLE_KEY",
    }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const id = text(body.id, 120);
  const platform = normalizePlatform(body.platform);
  const accountRef = text(body.account_ref, 240);
  const targetMode = mode(body.mode);
  const patch = asRecord(body.config);

  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  if (!platform) return NextResponse.json({ ok: false, error: "platform is required" }, { status: 400 });
  if (!accountRef) return NextResponse.json({ ok: false, error: "account_ref is required" }, { status: 400 });

  const currentRes = await db
    .from("factory_distribution_targets")
    .select("id,platform,account_ref,mode,config")
    .eq("id", id)
    .limit(1)
    .maybeSingle();
  if (currentRes.error) {
    return NextResponse.json({ ok: false, error: currentRes.error.message }, { status: 500 });
  }

  const current = currentRes.data as JsonRecord | null;
  const nextConfig = mergeDistributionTargetConfig(current?.config, {
    session_valid: true,
    health_state: "green",
    warmup_stage: "active",
    worker_box_id: "cloud",
    compliance_status: "approved",
    ...patch,
  });

  const payload = {
    id,
    platform,
    account_ref: accountRef,
    mode: targetMode,
    config: nextConfig,
  };

  const { data, error } = await db
    .from("factory_distribution_targets")
    .upsert(payload, { onConflict: "id" })
    .select("id,platform,account_ref,mode,config,created_at,updated_at")
    .limit(1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, target: Array.isArray(data) ? data[0] : null });
}
