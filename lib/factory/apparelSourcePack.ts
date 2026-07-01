import { diskById, normColor, NORVIA_LINE, sourceFor } from "./contentDisks";
import { yaCollectImages, type YaItem } from "@/lib/yandex/disk";

export type ApparelSourceRole =
  | "clean_front"
  | "on_model_front"
  | "back"
  | "side"
  | "fabric_macro"
  | "closure_detail"
  | "hood_detail"
  | "lining_detail";

export interface ApparelSourcePackAsset {
  role: ApparelSourceRole;
  disk: string;
  path: string;
  name: string;
  score: number;
  color: string;
  reasons: string[];
  url: string;
}

export interface ApparelSourcePack {
  article: string;
  product: string;
  category: "apparel";
  sourceDisk: string;
  color: string | null;
  roles: Record<ApparelSourceRole, ApparelSourcePackAsset | null>;
  candidates: ApparelSourcePackAsset[];
  missingRoles: ApparelSourceRole[];
}

const REQUIRED_ROLES: ApparelSourceRole[] = ["clean_front", "back", "side", "fabric_macro", "on_model_front"];
const ROLE_PICK_ORDER: ApparelSourceRole[] = [
  "clean_front",
  "on_model_front",
  "side",
  "back",
  "fabric_macro",
  "closure_detail",
  "lining_detail",
  "hood_detail",
];
const COLOR_HINTS = [
  "темно зелен",
  "темно-зелен",
  "светл зелен",
  "светл-зелен",
  "зелен",
  "синий",
  "беж",
  "черн",
  "бел",
  "сер",
];

function cleanText(value: unknown, max = 240): string {
  return String(value || "").trim().slice(0, max);
}

function lineForPath(path: string): string | null {
  const lineFolder = path.replace(/^\/+/, "").split("/")[0]?.trim();
  return lineFolder ? NORVIA_LINE[lineFolder] || null : null;
}

function colorForPath(path: string): string {
  return path.replace(/^\/+/, "").split("/")[1]?.trim() || "";
}

function productColorHint(product: string): string {
  const normalized = normColor(product);
  return COLOR_HINTS.find((hint) => normalized.includes(normColor(hint))) || "";
}

function isRawNorviaPhoto(item: YaItem): boolean {
  return /^IMG_\d{4}\.JPG$/.test(item.name);
}

function isPosterLike(item: YaItem): boolean {
  return /\.png$/i.test(item.name) || /инфограф|коллаж|обложк|бренд|логотип|монтажная|карточк/i.test(`${item.name} ${item.path}`);
}

function frameNumber(name: string): number | null {
  const match = name.match(/^IMG_(\d{4})\./i);
  return match ? Number(match[1]) : null;
}

function roleScore(role: ApparelSourceRole, item: YaItem, relativeIndex: number, productColor: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const n = frameNumber(item.name) || 0;
  const folderColor = normColor(colorForPath(item.path));
  if (isRawNorviaPhoto(item)) { score += 20; reasons.push("raw_photoshoot"); }
  if (folderColor && productColor && (productColor.includes(folderColor) || folderColor.includes(productColor))) {
    score += 8;
    reasons.push("color_match");
  }
  if (isPosterLike(item)) { score -= 40; reasons.push("poster_like"); }

  if (role === "clean_front") {
    if (relativeIndex >= 0.48 && relativeIndex <= 0.72) { score += 10; reasons.push("mid_series_front_candidate"); }
    if ([7062, 7070, 7071, 7073].includes(n)) { score += 8; reasons.push("known_closed_front_frame"); }
    if ([7069, 7072, 7074].includes(n)) { score -= 4; reasons.push("open_or_side_pose"); }
  }
  if (role === "on_model_front") {
    if (relativeIndex >= 0.42 && relativeIndex <= 0.72) { score += 8; reasons.push("mid_series_on_model"); }
    if ([7062, 7069, 7070, 7071, 7073].includes(n)) { score += 5; reasons.push("known_front_pose"); }
  }
  if (role === "side") {
    if (relativeIndex >= 0.55 && relativeIndex <= 0.75) { score += 7; reasons.push("late_mid_series_side_candidate"); }
    if ([7072, 7074].includes(n)) { score += 10; reasons.push("known_side_frame"); }
  }
  if (role === "back") {
    if (relativeIndex >= 0.68 && relativeIndex <= 0.82) { score += 8; reasons.push("late_series_back_candidate"); }
    if ([7075, 7076].includes(n)) { score += 10; reasons.push("known_back_frame"); }
  }
  if (role === "fabric_macro" || role === "closure_detail" || role === "lining_detail") {
    if (relativeIndex <= 0.22) { score += 8; reasons.push("early_series_detail_candidate"); }
    if ([7045, 7046, 7047, 7058].includes(n)) { score += 5; reasons.push("known_detail_frame"); }
    if (role === "fabric_macro" && n === 7047) { score += 8; reasons.push("known_fabric_frame"); }
    if (role === "fabric_macro" && n === 7045) { score += 5; reasons.push("known_fabric_frame"); }
    if (role === "closure_detail" && [7046, 7058].includes(n)) { score += 6; reasons.push("known_closure_frame"); }
    if (role === "lining_detail" && n === 7058) { score += 8; reasons.push("known_lining_frame"); }
    if (role === "lining_detail" && n === 7045) { score += 4; reasons.push("known_lining_frame"); }
  }
  if (role === "hood_detail") {
    if (relativeIndex >= 0.82) { score += 8; reasons.push("tail_series_hood_candidate"); }
    if ([7077, 7078, 8800].includes(n)) { score += 9; reasons.push("known_hood_frame"); }
  }

  return { score, reasons };
}

function yandexImgUrl(item: YaItem, diskKey: string): string {
  return `/api/lab/yandex-img?path=${encodeURIComponent(item.path)}&key=${encodeURIComponent(diskKey)}`;
}

function pickRoleCandidate(candidates: ApparelSourcePackAsset[], role: ApparelSourceRole, usedPaths: Set<string>): ApparelSourcePackAsset | null {
  const roleCandidates = candidates.filter((candidate) => candidate.role === role);
  const top = roleCandidates[0];
  if (!top) return null;
  const uniqueCandidate = roleCandidates.find((candidate) => !usedPaths.has(candidate.path) && candidate.score >= top.score - 8);
  return uniqueCandidate || top;
}

export async function buildApparelSourcePack(input: {
  article: string;
  product?: string;
  limitPerRole?: number;
}): Promise<ApparelSourcePack | { error: string }> {
  const article = cleanText(input.article, 80);
  if (!article) return { error: "нужен article" };
  const product = cleanText(input.product || article, 240);
  const source = sourceFor(product, article);
  if (!source || source.disk.id !== "norvia") return { error: "apparel source pack пока поддерживает NORVIA" };
  const disk = diskById(source.disk.id);
  if (!disk) return { error: "неизвестный disk" };
  const productColor = productColorHint(product);
  const all: YaItem[] = [];
  for (const root of source.paths) all.push(...await yaCollectImages(root, 2, disk.key));

  const byFolder = new Map<string, YaItem[]>();
  for (const item of all) {
    if (!item.isImage) continue;
    const itemLine = lineForPath(item.path);
    if (itemLine !== article && !article.startsWith(`${itemLine}-`)) continue;
    const folderColor = normColor(colorForPath(item.path));
    if (productColor && folderColor && !(productColor.includes(folderColor) || folderColor.includes(productColor))) continue;
    if (!isRawNorviaPhoto(item) && isPosterLike(item)) continue;
    const folder = item.path.split("/").slice(0, -1).join("/");
    const arr = byFolder.get(folder) || [];
    arr.push(item);
    byFolder.set(folder, arr);
  }

  const candidates: ApparelSourcePackAsset[] = [];
  const roles: ApparelSourcePack["roles"] = {
    clean_front: null,
    on_model_front: null,
    back: null,
    side: null,
    fabric_macro: null,
    closure_detail: null,
    hood_detail: null,
    lining_detail: null,
  };

  for (const [, items] of byFolder) {
    const raw = [...items].filter(isRawNorviaPhoto).sort((a, b) => (frameNumber(a.name) || 0) - (frameNumber(b.name) || 0));
    const ordered = raw.length ? raw : [...items].sort((a, b) => a.name.localeCompare(b.name));
    const denominator = Math.max(1, ordered.length - 1);
    for (let index = 0; index < ordered.length; index++) {
      const item = ordered[index];
      const relativeIndex = index / denominator;
      for (const role of Object.keys(roles) as ApparelSourceRole[]) {
        const scored = roleScore(role, item, relativeIndex, productColor);
        if (scored.score <= 0) continue;
        const asset: ApparelSourcePackAsset = {
          role,
          disk: disk.id,
          path: item.path,
          name: item.name,
          score: scored.score,
          color: colorForPath(item.path),
          reasons: scored.reasons,
          url: yandexImgUrl(item, disk.key),
        };
        candidates.push(asset);
        const current = roles[role];
        if (!current || asset.score > current.score || (asset.score === current.score && asset.path.localeCompare(current.path) < 0)) {
          roles[role] = asset;
        }
      }
    }
  }

  const limit = Math.max(1, Math.min(20, input.limitPerRole || 6));
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const usedPaths = new Set<string>();
  for (const role of ROLE_PICK_ORDER) {
    const selected = pickRoleCandidate(candidates, role, usedPaths);
    roles[role] = selected;
    if (selected) usedPaths.add(selected.path);
  }
  return {
    article,
    product,
    category: "apparel",
    sourceDisk: disk.id,
    color: productColor || null,
    roles,
    candidates: candidates.slice(0, limit * Object.keys(roles).length),
    missingRoles: REQUIRED_ROLES.filter((role) => !roles[role]),
  };
}

export function apparelSourcePackRows(pack: ApparelSourcePack) {
  return (Object.values(pack.roles).filter(Boolean) as ApparelSourcePackAsset[]).map((asset) => ({
    disk: "product_truth",
    path: `${asset.disk}:${asset.path}#${asset.role}`,
    name: `${pack.article} · ${asset.role} · ${asset.name}`.slice(0, 120),
    kind: "image",
    niche: pack.category,
    article: pack.article,
    color: asset.color || null,
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
        truth: ["clean_front", "on_model_front", "back", "side"].includes(asset.role) ? "truthful_source" : "detail_source",
      },
    },
  }));
}
