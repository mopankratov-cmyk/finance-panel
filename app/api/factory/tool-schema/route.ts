import { NextRequest, NextResponse } from "next/server";
import { TOOL_SCHEMAS, toolSchema, allToolKeys } from "@/lib/factory/toolSchemas";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// §6 V3: реестр настроек инструментов для рендера ИНСПЕКТОРА ноды.
// Принцип «настраиваемо под капотом, просто сверху» — ВСЕ поля открыты, сгруппированы.
//   GET                 → { tools:[ключи], schemas:{tool→{groups}} }  (весь реестр)
//   GET ?tool=seedance  → одна схема { tool, label, node_types, groups }
//   GET ?node_type=hook_ugc → какие инструменты подходят ноде + их схемы
// Всегда JSON.
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const tool = (sp.get("tool") || "").trim();
    const nodeType = (sp.get("node_type") || "").trim();

    if (tool) {
      const s = toolSchema(tool);
      if (!s) return NextResponse.json({ error: `инструмент «${tool}» не в реестре`, tools: allToolKeys() }, { status: 404 });
      return NextResponse.json({ ok: true, schema: s }, { headers: { "Cache-Control": "no-store" } });
    }

    if (nodeType) {
      const fits = Object.values(TOOL_SCHEMAS).filter((s) => s.node_types.includes(nodeType));
      return NextResponse.json({ ok: true, node_type: nodeType, tools: fits.map((s) => s.tool), schemas: Object.fromEntries(fits.map((s) => [s.tool, s])) }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ ok: true, tools: allToolKeys(), schemas: TOOL_SCHEMAS }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "tool-schema crash: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
