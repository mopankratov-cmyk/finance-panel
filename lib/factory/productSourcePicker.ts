import { articleForPath, diskById, sourceFor } from "./contentDisks";
import { yaCollectImages, type YaItem } from "@/lib/yandex/disk";

export interface ProductSourceCandidate {
  disk: string;
  path: string;
  name: string;
  score: number;
  reasons: string[];
}

function sourceScore(item: YaItem, article: string): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const name = item.name.toLowerCase();
  if (!item.isImage) return { score: -100, reasons: ["not_image"] };
  if (/обложк|cover|логотип|brand|screenshot|icon/i.test(item.name)) return { score: -50, reasons: ["service_or_cover"] };
  if (/\.png$/i.test(item.name)) { score += 2; reasons.push("png"); }
  if (/^1\./.test(name) || /^2\./.test(name)) { score += 2; reasons.push("early_packshot_candidate"); }
  if (/new/i.test(item.path)) { score += 2; reasons.push("new_folder"); }
  if (/светл/i.test(item.path)) { score += 1; reasons.push("light_variant"); }
  if (articleForPath("design", item.path) === article) { score += 4; reasons.push("article_folder_match"); }
  return { score, reasons };
}

export async function pickProductSource(input: { article: string; product?: string }): Promise<ProductSourceCandidate | null> {
  const source = sourceFor(input.product || input.article, input.article);
  if (!source) return null;
  const disk = diskById(source.disk.id);
  if (!disk) return null;
  const candidates: ProductSourceCandidate[] = [];
  for (const root of source.paths) {
    const images = await yaCollectImages(root, 2, disk.key);
    for (const image of images) {
      const s = sourceScore(image, input.article);
      if (s.score < 0) continue;
      candidates.push({ disk: disk.id, path: image.path, name: image.name, score: s.score, reasons: s.reasons });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return candidates[0] || null;
}

