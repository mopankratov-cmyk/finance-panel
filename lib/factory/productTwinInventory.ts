import { ARTICLE_FOLDERS, GROUP_SOURCES, sourceFor } from "./contentDisks";
import { pickProductSourceCandidates, type ProductSourceCandidate } from "./productSourcePicker";
import { buildProductTwinPreparationPlan } from "./productTwinPrepPlan";
import { normalizeTwinCategory, type ProductTwinCategory } from "./productTwin";
import { buildApparelSourcePack } from "./apparelSourcePack";
import { buildBagSourcePack } from "./bagSourcePack";

export interface ProductSourcePackReadiness {
  supported: boolean;
  category: ProductTwinCategory;
  ok: boolean;
  sourceDisk?: string;
  sourceRoot?: string;
  presentRoles: string[];
  missingRoles: string[];
  primarySourcePath?: string;
  error?: string;
}

export interface ProductTwinInventoryItem {
  article: string;
  product: string;
  category: ProductTwinCategory;
  sourceDisk: string;
  sourceRoots: string[];
  explicitFolder?: string;
  candidates: ProductSourceCandidate[];
  sourcePackReadiness: ProductSourcePackReadiness;
  bestSourceScore: number | null;
  readiness: {
    hasSource: boolean;
    hasStrongSource: boolean;
    canBuildCleanTwin: boolean;
    plannedViews: number;
    requiredViews: number;
  };
  missingRequiredViews: string[];
}

async function buildSourcePackReadiness(input: {
  article: string;
  product: string;
  category: ProductTwinCategory;
}): Promise<ProductSourcePackReadiness> {
  if (input.category === "apparel") {
    const pack = await buildApparelSourcePack(input);
    if ("error" in pack) return { supported: true, category: input.category, ok: false, presentRoles: [], missingRoles: [], error: pack.error };
    const presentRoles = Object.entries(pack.roles).filter(([, asset]) => Boolean(asset)).map(([role]) => role);
    return {
      supported: true,
      category: input.category,
      ok: pack.missingRoles.length === 0,
      sourceDisk: pack.sourceDisk,
      presentRoles,
      missingRoles: pack.missingRoles,
      primarySourcePath: pack.roles.clean_front?.path || pack.roles.on_model_front?.path,
    };
  }
  if (input.category === "bag") {
    const pack = await buildBagSourcePack(input);
    if ("error" in pack) return { supported: true, category: input.category, ok: false, presentRoles: [], missingRoles: [], error: pack.error };
    const presentRoles = Object.entries(pack.roles).filter(([, asset]) => Boolean(asset)).map(([role]) => role);
    return {
      supported: true,
      category: input.category,
      ok: pack.missingRoles.length === 0,
      sourceDisk: pack.sourceDisk,
      sourceRoot: pack.sourceRoot,
      presentRoles,
      missingRoles: pack.missingRoles,
      primarySourcePath: pack.roles.front?.path || pack.roles.three_quarter?.path,
    };
  }
  return { supported: false, category: input.category, ok: false, presentRoles: [], missingRoles: [] };
}

export function inferProductName(article: string): string {
  const mapped = ARTICLE_FOLDERS.find((item) => item.article === article);
  const folder = mapped?.prefix.split("/").filter(Boolean).pop();
  if (/^NV[-\w]*/i.test(article)) return `NORVIA куртка ${article}`;
  if (mapped?.prefix.includes("/Сумки/")) return `сумка ${folder || article}`;
  if (mapped?.prefix.includes("Крем")) return `крем ${folder || article}`;
  if (mapped?.prefix.includes("УЗИ") || mapped?.prefix.includes("Винтовка")) return `бластер ${folder || article}`;
  return folder || article;
}

function uniqueArticles(): string[] {
  const set = new Set<string>();
  for (const folder of ARTICLE_FOLDERS) set.add(folder.article);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function listKnownProductArticles(): string[] {
  return uniqueArticles();
}

export async function buildProductTwinInventory(input: {
  articles?: string[];
  limit?: number;
  candidateLimit?: number;
  probeLimit?: number;
} = {}): Promise<ProductTwinInventoryItem[]> {
  const articles = (input.articles?.length ? input.articles : uniqueArticles()).slice(0, Math.max(1, Math.min(200, input.limit || 200)));
  const items: ProductTwinInventoryItem[] = [];
  for (const article of articles) {
    const product = inferProductName(article);
    const category = normalizeTwinCategory(undefined, article, product);
    const source = sourceFor(product, article);
    const explicit = ARTICLE_FOLDERS.find((item) => item.article === article);
    const candidates = await pickProductSourceCandidates({
      article,
      product,
      limit: input.candidateLimit ?? 6,
      probeLimit: input.probeLimit ?? 8,
    });
    const prep = buildProductTwinPreparationPlan({ article, product, category });
    const sourcePackReadiness = await buildSourcePackReadiness({ article, product, category });
    const required = prep.canonicalViews.filter((view) => view.required);
    const bestScore = candidates[0]?.score ?? null;
    items.push({
      article,
      product,
      category,
      sourceDisk: source?.disk.id || explicit?.disk || "unknown",
      sourceRoots: source?.paths || (explicit ? [explicit.prefix] : []),
      explicitFolder: explicit?.prefix,
      candidates,
      sourcePackReadiness,
      bestSourceScore: bestScore,
      readiness: {
        hasSource: candidates.length > 0,
        hasStrongSource: bestScore != null && bestScore >= 12,
        canBuildCleanTwin: candidates.length > 0,
        plannedViews: prep.canonicalViews.length + prep.serviceAssets.length,
        requiredViews: required.length + prep.serviceAssets.filter((view) => view.required).length,
      },
      missingRequiredViews: required.map((view) => view.id),
    });
  }
  return items;
}

export function productTwinInventorySummary(items: ProductTwinInventoryItem[]) {
  return {
    total: items.length,
    byCategory: GROUP_SOURCES.reduce<Record<string, number>>((acc, source) => {
      acc[source.niche] = items.filter((item) => item.sourceRoots.some((root) => source.paths.includes(root))).length;
      return acc;
    }, {}),
    buildable: items.filter((item) => item.readiness.canBuildCleanTwin).length,
    strongSource: items.filter((item) => item.readiness.hasStrongSource).length,
    sourcePackReady: items.filter((item) => item.sourcePackReadiness.supported && item.sourcePackReadiness.ok).length,
  };
}
