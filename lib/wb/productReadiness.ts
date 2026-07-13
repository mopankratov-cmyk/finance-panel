export const PRODUCT_READINESS_STATUSES = ["pending", "in_progress", "ready", "blocked"] as const;
export type ProductReadinessStatus = typeof PRODUCT_READINESS_STATUSES[number];

export interface ProductReadinessInput {
  name: string;
  brand: string;
  subject: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weightBrutto: number | null;
  materials: string;
  photosCount: number;
}

export interface ProductNoteInput {
  status?: unknown;
  comment?: unknown;
  driveUrl?: unknown;
}

const clean = (value: unknown, max: number) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

export function productReadiness(row: ProductReadinessInput) {
  const checks = [
    { key: "name", label: "Название", ok: Boolean(clean(row.name, 500)) },
    { key: "brand", label: "Бренд", ok: Boolean(clean(row.brand, 255)) },
    { key: "subject", label: "Категория", ok: Boolean(clean(row.subject, 255)) },
    { key: "dimensions", label: "Размеры", ok: [row.length, row.width, row.height].every((value) => Number(value) > 0) },
    { key: "weight", label: "Вес брутто", ok: Number(row.weightBrutto) > 0 },
    { key: "materials", label: "Материалы / состав", ok: Boolean(clean(row.materials, 2000)) },
    { key: "photos", label: "Минимум 3 фото", ok: Number(row.photosCount) >= 3 },
  ];
  const completed = checks.filter((check) => check.ok).length;
  return { score: Math.round(completed / checks.length * 100), checks, missing: checks.filter((check) => !check.ok).map((check) => check.label) };
}

export function normalizeProductNote(input: ProductNoteInput) {
  const status = clean(input.status, 40) as ProductReadinessStatus;
  if (!PRODUCT_READINESS_STATUSES.includes(status)) return { ok: false as const, error: "Неизвестный статус готовности" };
  const comment = clean(input.comment, 4000);
  const rawDriveUrl = clean(input.driveUrl, 2048);
  let driveUrl: string | null = null;
  if (rawDriveUrl) {
    try {
      const url = new URL(rawDriveUrl);
      if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || !url.pathname.startsWith("/drive/folders/")) throw new Error();
      driveUrl = url.toString();
    } catch {
      return { ok: false as const, error: "Укажите HTTPS-ссылку на папку Google Drive" };
    }
  }
  return { ok: true as const, value: { status, comment, driveUrl } };
}

export function readinessStatusLabel(status: ProductReadinessStatus) {
  return ({ pending: "Не проверено", in_progress: "В работе", ready: "Готово", blocked: "Заблокировано" } as const)[status];
}
