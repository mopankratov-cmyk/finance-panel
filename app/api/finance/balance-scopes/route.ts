import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadBalanceCompanyScopes } from "@/lib/finance/balanceScopes";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiSession(["director", "fin_director", "financier"]);
  if (gate) return gate;
  try {
    const companies = await loadBalanceCompanyScopes();
    return NextResponse.json({ companies: companies.map(({ id, name, companyIds }) => ({ id, name, companyIds })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить юрлица" }, { status: 500 });
  }
}
