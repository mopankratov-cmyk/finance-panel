import { NextResponse } from "next/server";
import { countUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

// Есть ли уже пользователи (для UX первого запуска — «Создать директора»).
export async function GET() {
  const n = await countUsers();
  return NextResponse.json({ hasUsers: n > 0 });
}
