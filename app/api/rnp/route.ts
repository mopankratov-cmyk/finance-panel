import { NextResponse } from "next/server";
import { buildRnpReport } from "@/lib/rnp/buildRnp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await buildRnpReport();
    return NextResponse.json({ data: rows, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
