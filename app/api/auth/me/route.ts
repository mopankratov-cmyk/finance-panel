import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getServerSession();
  if (!s) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      email: s.email,
      role: s.role,
      // Без этого поля браузер видел только основную роль: у сотрудника с
      // несколькими ролями (например wb_manager + financier) кнопки,
      // завязанные на неосновную роль, гасли молча — see MANUAL_RUN_ROLES.
      roles: s.roles,
      cabinet_ids: s.cabinet_ids,
      organization_id: s.organization_id,
    },
  });
}
