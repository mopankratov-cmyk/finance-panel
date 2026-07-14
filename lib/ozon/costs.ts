export interface OzonCostSourceRow {
  article?: unknown;
  name?: unknown;
  cost_rub?: unknown;
}

export interface OzonCostRecord {
  article: string;
  name: string;
  cost: number;
  nameKey: string;
}

export interface OzonCostMatch {
  article: string;
  name: string;
  cost: number;
  source: "article" | "name";
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "для",
  "или",
  "из",
  "на",
  "от",
  "под",
  "по",
  "при",
  "с",
  "со",
]);

export function normalizeOzonCostArticle(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleUpperCase("ru-RU");
}

export function normalizeOzonProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(value: string) {
  return [...new Set(value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))];
}

function compact(value: string) {
  return value.replace(/\s+/g, "");
}

function diceSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return 0;
  const grams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index <= value.length - 3; index += 1) {
      const gram = value.slice(index, index + 3);
      result.set(gram, (result.get(gram) ?? 0) + 1);
    }
    return result;
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  let overlap = 0;
  for (const [gram, count] of leftGrams) overlap += Math.min(count, rightGrams.get(gram) ?? 0);
  const total = [...leftGrams.values()].reduce((sum, count) => sum + count, 0)
    + [...rightGrams.values()].reduce((sum, count) => sum + count, 0);
  return total > 0 ? (2 * overlap) / total : 0;
}

export function ozonProductNameSimilarity(leftName: unknown, rightName: unknown) {
  const left = normalizeOzonProductName(leftName);
  const right = normalizeOzonProductName(rightName);
  if (!left || !right) return 0;
  const leftCompact = compact(left);
  const rightCompact = compact(right);
  if (leftCompact === rightCompact) return 1;
  if (leftCompact.length >= 12 && rightCompact.length >= 12 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
    return 0.96;
  }

  const leftTokens = nameTokens(left);
  const rightTokens = nameTokens(right);
  const rightSet = new Set(rightTokens);
  const common = leftTokens.filter((token) => rightSet.has(token)).length;
  const tokenScore = common >= 2
    ? Math.min(common / Math.max(1, leftTokens.length), common / Math.max(1, rightTokens.length))
    : 0;
  return Math.max(tokenScore, diceSimilarity(leftCompact, rightCompact));
}

export function createOzonCostResolver(rows: readonly OzonCostSourceRow[]) {
  const byArticle = new Map<string, OzonCostRecord>();
  const byName = new Map<string, OzonCostRecord | null>();
  const records: OzonCostRecord[] = [];

  for (const row of rows) {
    const article = String(row.article ?? "").normalize("NFKC").trim();
    if (!article) continue;
    const record: OzonCostRecord = {
      article,
      name: String(row.name ?? "").normalize("NFKC").trim(),
      cost: Number(row.cost_rub ?? 0),
      nameKey: normalizeOzonProductName(row.name),
    };
    records.push(record);
    if (record.cost <= 0) continue;

    const articleKey = normalizeOzonCostArticle(article);
    const existingArticle = byArticle.get(articleKey);
    if (!existingArticle) byArticle.set(articleKey, record);

    if (!record.nameKey) continue;
    const existingName = byName.get(record.nameKey);
    if (existingName === undefined) byName.set(record.nameKey, record);
    else if (existingName && existingName.article !== record.article && existingName.cost !== record.cost) byName.set(record.nameKey, null);
  }

  const resolveByName = (names: readonly unknown[]) => {
    for (const rawName of names) {
      const nameKey = normalizeOzonProductName(rawName);
      if (!nameKey) continue;
      const exact = byName.get(nameKey);
      if (exact) return exact;
      if (exact === null) continue;

      let best: OzonCostRecord | null = null;
      let bestScore = 0;
      let secondScore = 0;
      for (const record of records) {
        if (record.cost <= 0 || !record.nameKey) continue;
        const score = ozonProductNameSimilarity(nameKey, record.nameKey);
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          best = record;
        } else if (score > secondScore) {
          secondScore = score;
        }
      }
      if (best && bestScore >= 0.86 && bestScore - secondScore >= 0.08) return best;
    }
    return null;
  };

  return {
    resolve(input: { offerId?: unknown; names?: readonly unknown[] }): OzonCostMatch | null {
      const article = byArticle.get(normalizeOzonCostArticle(input.offerId));
      if (article) return { article: article.article, name: article.name, cost: article.cost, source: "article" };
      const byProductName = resolveByName(input.names ?? []);
      return byProductName ? { article: byProductName.article, name: byProductName.name, cost: byProductName.cost, source: "name" } : null;
    },
  };
}
