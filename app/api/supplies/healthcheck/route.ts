import { NextRequest } from "next/server";
import { GET as wmsHealth } from "@/app/api/supplies/wms-health/route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Старое имя Inferno-контракта остаётся рабочим; источник истины один.
export async function GET(request: NextRequest) {
  return wmsHealth(request);
}
