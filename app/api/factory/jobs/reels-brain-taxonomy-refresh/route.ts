import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { extractJsonArray } from "@/lib/factory/extractJson";
import { inferHookType, inferStructureType } from "@/lib/factory/reelsBrainPatterns";
import {
  mergeTaxonomyPlaybook,
  normalizeHookTypeV2,
  normalizeStructureTypeV2,
  taxonomyPromptBlock,
  type ReelsTaxonomyClassificationResult,
} from "@/lib/factory/reelsBrainTaxonomy";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = "claude-haiku-4-5";
const SUPABASE_PAGE_SIZE = 500;
const MAX_SCAN_ROWS = 5000;

type CandidateRow = {
  id: number;
  niche: string | null;
  url: string | null;
  caption: string | null;
  hook_text: string | null;
  format_detected: string | null;
  viral_reason: unknown;
  analyzed_full: unknown;
  analyzed: boolean | null;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function splitNiches(value: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function currentHookType(row: CandidateRow): string {
  const analyzed = rec(row.analyzed_full);
  return String(
    analyzed.hook_type_v2
    || analyzed.hook_type
    || analyzed.hook_category
    || inferHookType(row.hook_text || row.caption || ""),
  ).trim().toLowerCase();
}

function currentStructureType(row: CandidateRow): string {
  const analyzed = rec(row.analyzed_full);
  return String(
    analyzed.structure_v2
    || analyzed.structure_type
    || analyzed.format_detected
    || inferStructureType(row.format_detected, row.caption),
  ).trim().toLowerCase();
}

function needsTaxonomyRefresh(row: CandidateRow): boolean {
  if (row.analyzed !== true) return false;
  const hookType = currentHookType(row);
  const structureType = currentStructureType(row);
  const analyzed = rec(row.analyzed_full);
  const hasV2 = Boolean(String(analyzed.hook_type_v2 || "").trim()) && Boolean(String(analyzed.structure_v2 || "").trim());
  if (hasV2 && !hookType.startsWith("other:") && !structureType.startsWith("other:")) return false;
  return hookType === "direct_claim"
    || hookType === "unknown"
    || structureType === "unknown_structure"
    || hookType.startsWith("other:")
    || structureType.startsWith("other:");
}

async function loadCandidates(input: {
  limit: number;
  niches: string[];
}) {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [] as CandidateRow[], error: "Supabase не настроен" };

  const rows: CandidateRow[] = [];
  for (let from = 0; from < MAX_SCAN_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_SCAN_ROWS - 1);
    let query = db
      .from("viral_videos")
      .select("id,niche,url,caption,hook_text,format_detected,viral_reason,analyzed_full,analyzed")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .range(from, to);
    if (input.niches.length) query = query.in("niche", input.niches);
    const { data, error } = await query;
    if (error) return { rows, error: error.message };
    const page = (data || []) as CandidateRow[];
    rows.push(...page.filter(needsTaxonomyRefresh));
    if (rows.length >= input.limit || page.length < SUPABASE_PAGE_SIZE) break;
  }
  return { rows: rows.slice(0, input.limit), error: null };
}

async function classifyBatch(rows: CandidateRow[]) {
  const client = await createClaudeClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY не настроен");

  const system = `${taxonomyPromptBlock()}\nНикакого markdown, только JSON-массив.`;
  const user = JSON.stringify(rows.map((row) => ({
    id: row.id,
    niche: row.niche,
    hook_text: row.hook_text || null,
    caption: row.caption || null,
    viral_reason: row.viral_reason || null,
    current_hook_type: currentHookType(row),
    current_structure_type: currentStructureType(row),
  })));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2400,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = (response.content as Array<{ type?: string; text?: string }>)
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join(" ")
    .trim();
  const parsed = extractJsonArray(text);
  if (!parsed) throw new Error("taxonomy classifier did not return JSON array");

  const byId = new Map(rows.map((row) => [row.id, row]));
  return parsed
    .map((item) => rec(item))
    .map((item): ReelsTaxonomyClassificationResult | null => {
      const id = Number(item.id);
      const source = byId.get(id);
      if (!source || !Number.isFinite(id)) return null;
      return {
        id,
        niche: String(source.niche || "").trim() || "default",
        hook_type_v2: normalizeHookTypeV2(item.hook_type_v2, currentHookType(source) === "unknown" ? "unknown" : "direct_claim"),
        structure_v2: normalizeStructureTypeV2(item.structure_v2, "unknown_structure"),
        confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.5) || 0.5)),
      };
    })
    .filter((row): row is ReelsTaxonomyClassificationResult => Boolean(row));
}

async function persistClassifications(rows: CandidateRow[], classified: ReelsTaxonomyClassificationResult[], threshold: number) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const sourceMap = new Map(rows.map((row) => [row.id, row]));
  const updated: ReelsTaxonomyClassificationResult[] = [];

  for (const row of classified) {
    const source = sourceMap.get(row.id);
    if (!source) continue;
    const analyzedFull = rec(source.analyzed_full);
    const payload = {
      ...analyzedFull,
      hook_type_v2: row.hook_type_v2,
      structure_v2: row.structure_v2,
      taxonomy_confidence: row.confidence,
      taxonomy_model: MODEL,
      taxonomy_updated_at: new Date().toISOString(),
    };
    const { error } = await db
      .from("viral_videos")
      .update({ analyzed_full: payload, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (!error) updated.push(row);
  }

  const byNiche = new Map<string, ReelsTaxonomyClassificationResult[]>();
  for (const row of updated) {
    const items = byNiche.get(row.niche) || [];
    items.push(row);
    byNiche.set(row.niche, items);
  }

  const taxonomy_updates = [];
  for (const [niche, items] of byNiche.entries()) {
    const { data } = await db.from("niche_playbooks").select("playbook").eq("niche", niche).limit(1);
    const current = ((data as { playbook?: unknown }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
    const merged = mergeTaxonomyPlaybook(current, items, threshold);
    const { error } = await db.from("niche_playbooks").upsert({
      niche,
      playbook: { ...merged.playbook, niche },
      updated_at: new Date().toISOString(),
    }, { onConflict: "niche" });
    taxonomy_updates.push({
      niche,
      classified: items.length,
      promoted_hooks: merged.promoted_hooks,
      promoted_structures: merged.promoted_structures,
      error: error?.message || null,
    });
  }

  return { updated, taxonomy_updates };
}

async function run(req: NextRequest, execute: boolean, body: Record<string, unknown>) {
  const limit = Math.max(1, Math.min(100, Number(body.limit || req.nextUrl.searchParams.get("limit") || 50)));
  const threshold = Math.max(2, Math.min(10, Number(body.promote_threshold || req.nextUrl.searchParams.get("promote_threshold") || 3)));
  const niches = splitNiches(typeof body.niches === "string" ? body.niches : req.nextUrl.searchParams.get("niches"));
  const { rows, error } = await loadCandidates({ limit, niches });
  if (error) return NextResponse.json({ error: `viral_videos: ${error}` }, { status: 500 });
  if (!rows.length) {
    return NextResponse.json({ ok: true, execute, limit, threshold, niches, selected: 0, classified: 0, taxonomy_updates: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!execute) {
    return NextResponse.json({
      ok: true,
      execute,
      limit,
      threshold,
      niches,
      selected: rows.length,
      sample: rows.slice(0, 5).map((row) => ({
        id: row.id,
        niche: row.niche,
        url: row.url,
        current_hook_type: currentHookType(row),
        current_structure_type: currentStructureType(row),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const classified = await classifyBatch(rows);
  const persisted = await persistClassifications(rows, classified, threshold);
  return NextResponse.json({
    ok: true,
    execute,
    limit,
    threshold,
    niches,
    selected: rows.length,
    classified: persisted.updated.length,
    taxonomy_updates: persisted.taxonomy_updates,
    results: persisted.updated.slice(0, 20),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return await run(req, false, {});
  } catch (error) {
    return NextResponse.json({ error: "taxonomy-refresh crash: " + String((error as Error)?.message || error).slice(0, 180) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await run(req, body.dry_run === true ? false : true, body);
  } catch (error) {
    return NextResponse.json({ error: "taxonomy-refresh crash: " + String((error as Error)?.message || error).slice(0, 180) }, { status: 500 });
  }
}
