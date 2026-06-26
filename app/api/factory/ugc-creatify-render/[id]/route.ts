import { NextResponse } from "next/server";
import { creatifyStartRender } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";

// Явный старт рендера Creatify после готового превью.
// Статус-роут больше не дёргает платный /render/ на каждом poll.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = id.startsWith("cf.") ? id.slice(3) : "";
    if (!token) return NextResponse.json({ status: "error", error: "плохой task_id" }, { status: 400 });
    const s = await creatifyStartRender(token);
    if (s.status === "error") return NextResponse.json({ status: "failed", error: s.error }, { status: 502 });
    return NextResponse.json({ status: "rendering", progress: "рендер UGC-актёра (Creatify)…" });
  } catch (e) {
    return NextResponse.json({ status: "error", error: "рендер UGC Creatify упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
