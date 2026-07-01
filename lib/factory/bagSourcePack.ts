import { ARTICLE_FOLDERS, diskById } from "./contentDisks";
import { yaCollectImages, type YaItem } from "@/lib/yandex/disk";

export type BagSourceRole =
  | "front"
  | "three_quarter"
  | "side"
  | "back"
  | "hardware_macro"
  | "strap_detail"
  | "in_hand"
  | "on_shoulder";

export interface BagSourcePackAsset {
  role: BagSourceRole;
  disk: string;
  path: string;
  name: string;
  score: number;
  reasons: string[];
  url: string;
}

export interface BagSourcePack {
  article: string;
  product: string;
  category: "bag";
  sourceDisk: string;
  sourceRoot: string;
  roles: Record<BagSourceRole, BagSourcePackAsset | null>;
  candidates: BagSourcePackAsset[];
  missingRoles: BagSourceRole[];
}

const REQUIRED_ROLES: BagSourceRole[] = ["front", "three_quarter", "hardware_macro", "in_hand"];
const ROLE_PICK_ORDER: BagSourceRole[] = ["front", "three_quarter", "side", "back", "hardware_macro", "strap_detail", "in_hand", "on_shoulder"];

function cleanText(value: unknown, max = 240): string {
  return String(value || "").trim().slice(0, max);
}

function imageNumber(name: string): number | null {
  const match = name.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function isCoverLike(item: YaItem): boolean {
  return /^0\b/.test(item.name) || /обложк|cover|логотип|бренд/i.test(`${item.name} ${item.path}`);
}

function yandexImgUrl(item: YaItem, diskKey: string): string {
  return `/api/lab/yandex-img?path=${encodeURIComponent(item.path)}&key=${encodeURIComponent(diskKey)}`;
}

function roleScore(role: BagSourceRole, item: YaItem, relativeIndex: number): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const n = imageNumber(item.name) || 0;
  if (!item.isImage) return { score: -100, reasons: ["not_image"] };
  if (isCoverLike(item)) { score -= 50; reasons.push("cover_like"); }
  if (/\.(png|jpe?g|webp)$/i.test(item.name)) { score += 18; reasons.push("bag_source_image"); }
  if (n > 0) { score += 8; reasons.push("numbered_bag_frame"); }

  if (role === "front") {
    if (n >= 2 && n <= 5) { score += 10; reasons.push("early_packshot_candidate"); }
    if (relativeIndex <= 0.3) { score += 4; reasons.push("early_series_front_candidate"); }
  }
  if (role === "three_quarter") {
    if (n >= 4 && n <= 8) { score += 10; reasons.push("mid_packshot_candidate"); }
    if (relativeIndex >= 0.22 && relativeIndex <= 0.55) { score += 4; reasons.push("mid_series_angle_candidate"); }
  }
  if (role === "side" || role === "back") {
    if (n >= 7 && n <= 12) { score += 9; reasons.push("late_packshot_candidate"); }
    if (relativeIndex >= 0.48 && relativeIndex <= 0.82) { score += 4; reasons.push("late_series_angle_candidate"); }
    if (role === "back" && n >= 9) { score += 2; reasons.push("back_candidate"); }
  }
  if (role === "hardware_macro" || role === "strap_detail") {
    if (n >= 10) { score += 8; reasons.push("detail_frame_candidate"); }
    if (relativeIndex >= 0.62) { score += 5; reasons.push("tail_series_detail_candidate"); }
    if (role === "strap_detail" && n >= 12) { score += 2; reasons.push("strap_candidate"); }
  }
  if (role === "in_hand" || role === "on_shoulder") {
    if (n >= 5 && n <= 13) { score += 7; reasons.push("lifestyle_candidate"); }
    if (relativeIndex >= 0.3 && relativeIndex <= 0.85) { score += 4; reasons.push("middle_lifestyle_candidate"); }
    if (role === "on_shoulder" && n >= 8) { score += 2; reasons.push("worn_candidate"); }
  }

  return { score, reasons };
}

function pickRoleCandidate(candidates: BagSourcePackAsset[], role: BagSourceRole, usedPaths: Set<string>): BagSourcePackAsset | null {
  const roleCandidates = candidates.filter((candidate) => candidate.role === role);
  const top = roleCandidates[0];
  if (!top) return null;
  return roleCandidates.find((candidate) => !usedPaths.has(candidate.path) && candidate.score >= top.score - 8) || top;
}

export async function buildBagSourcePack(input: {
  article: string;
  product?: string;
  limitPerRole?: number;
}): Promise<BagSourcePack | { error: string }> {
  const article = cleanText(input.article, 80);
  if (!article) return { error: "нужен article" };
  const explicit = ARTICLE_FOLDERS.find((item) => item.article === article && item.prefix.includes("/Сумки/"));
  if (!explicit) return { error: "bag source pack требует явную папку сумки" };
  const disk = diskById(explicit.disk);
  if (!disk) return { error: "неизвестный disk" };
  const product = cleanText(input.product || explicit.prefix.split("/").pop() || article, 240);
  const images = (await yaCollectImages(explicit.prefix, 1, disk.key))
    .filter((item) => item.isImage && !isCoverLike(item))
    .sort((a, b) => (imageNumber(a.name) || 9999) - (imageNumber(b.name) || 9999) || a.name.localeCompare(b.name));

  const candidates: BagSourcePackAsset[] = [];
  const denominator = Math.max(1, images.length - 1);
  for (let index = 0; index < images.length; index++) {
    const item = images[index];
    const relativeIndex = index / denominator;
    for (const role of ROLE_PICK_ORDER) {
      const scored = roleScore(role, item, relativeIndex);
      if (scored.score <= 0) continue;
      candidates.push({
        role,
        disk: disk.id,
        path: item.path,
        name: item.name,
        score: scored.score,
        reasons: scored.reasons,
        url: yandexImgUrl(item, disk.key),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const roles = Object.fromEntries(ROLE_PICK_ORDER.map((role) => [role, null])) as BagSourcePack["roles"];
  const usedPaths = new Set<string>();
  for (const role of ROLE_PICK_ORDER) {
    const selected = pickRoleCandidate(candidates, role, usedPaths);
    roles[role] = selected;
    if (selected) usedPaths.add(selected.path);
  }

  const limit = Math.max(1, Math.min(20, input.limitPerRole || 6));
  return {
    article,
    product,
    category: "bag",
    sourceDisk: disk.id,
    sourceRoot: explicit.prefix,
    roles,
    candidates: candidates.slice(0, limit * ROLE_PICK_ORDER.length),
    missingRoles: REQUIRED_ROLES.filter((role) => !roles[role]),
  };
}

export function bagSourcePackRows(pack: BagSourcePack) {
  return (Object.values(pack.roles).filter(Boolean) as BagSourcePackAsset[]).map((asset) => ({
    disk: "product_truth",
    path: `${asset.disk}:${asset.path}#${asset.role}`,
    name: `${pack.article} · ${asset.role} · ${asset.name}`.slice(0, 120),
    kind: "image",
    niche: pack.category,
    article: pack.article,
    color: null,
    url: asset.url,
    analyzed: true,
    analysis: {
      product_source_pack: {
        article: pack.article,
        product: pack.product,
        category: pack.category,
        role: asset.role,
        source_disk: asset.disk,
        source_path: asset.path,
        score: asset.score,
        reasons: asset.reasons,
        truth: ["front", "three_quarter", "side", "back", "in_hand", "on_shoulder"].includes(asset.role) ? "truthful_source" : "detail_source",
      },
    },
  }));
}
