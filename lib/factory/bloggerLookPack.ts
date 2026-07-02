import { listBloggerVariants } from "@/lib/factory/bloggerRegistry";

export interface BloggerLookPackItem {
  variant_id: string;
  blogger_id: string;
  blogger_name: string;
  avatar_look_id: string;
  room_type: string;
  framing_type: string;
  expression_profile: string;
  motion_profile: string;
  status: "active" | "experimental" | "rework";
  notes: string[];
}

export interface BloggerLookPack {
  ok: boolean;
  mode: "katya-look-pack";
  blogger_id: string;
  anchor_variant_id: string;
  items: BloggerLookPackItem[];
  summary: {
    total: number;
    active: number;
    experimental: number;
    rework: number;
  };
}

export function buildKatyaLookPack(): BloggerLookPack {
  const items = listBloggerVariants()
    .filter((item) => item.blogger_id === "katya_russian_creator_v3b")
    .map((item) => ({
      variant_id: item.variant_id,
      blogger_id: item.blogger_id,
      blogger_name: item.blogger_name,
      avatar_look_id: item.avatar_look_id,
      room_type: item.room_type,
      framing_type: item.framing_type,
      expression_profile: item.expression_profile,
      motion_profile: item.motion_profile,
      status: item.status,
      notes: [...item.notes],
    }));

  return {
    ok: true,
    mode: "katya-look-pack",
    blogger_id: "katya_russian_creator_v3b",
    anchor_variant_id: "katya_russian_creator_v3b::mirror_core",
    items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      experimental: items.filter((item) => item.status === "experimental").length,
      rework: items.filter((item) => item.status === "rework").length,
    },
  };
}
