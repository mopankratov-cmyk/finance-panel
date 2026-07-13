export const UGC_AVATARS = [
  { id: "product", name: "Только товар", description: "Предметная сцена без человека", prompt: "product-only scene, no people, product remains the sole hero" },
  { id: "creator", name: "UGC-креатор", description: "Естественная домашняя подача", prompt: "friendly adult UGC creator in a natural home setting, authentic and not glossy" },
  { id: "expert", name: "Эксперт", description: "Уверенная демонстрация пользы", prompt: "professional adult product expert, clear demonstration, trustworthy presentation" },
  { id: "hands", name: "Руки в кадре", description: "Фокус на использовании товара", prompt: "hands-only product demonstration, no face, close-up usage details" },
] as const;

export const UGC_KINDS = ["image", "video"] as const;
export type UgcAvatarId = typeof UGC_AVATARS[number]["id"];
export type UgcKind = typeof UGC_KINDS[number];

const clean = (value: unknown, max: number) => String(value ?? "").normalize("NFKC").trim().slice(0, max);

export function normalizeUgcCreativeInput(input: Record<string, unknown>) {
  const avatarId = clean(input.avatarId, 40) as UgcAvatarId;
  const kind = clean(input.kind, 20) as UgcKind;
  if (!UGC_AVATARS.some((avatar) => avatar.id === avatarId)) return { ok: false as const, error: "Выберите персонажа" };
  if (input.kind !== undefined && !UGC_KINDS.includes(kind)) return { ok: false as const, error: "Выберите формат результата" };
  return { ok: true as const, value: {
    avatarId,
    kind: (kind || "image") as UgcKind,
    brief: clean(input.brief, 1_500),
    script: clean(input.script, 4_000),
    imagePrompt: clean(input.imagePrompt, 6_000),
    videoMotion: clean(input.videoMotion, 3_000),
  } };
}

export function ugcPublishPhrase(article: string) {
  return `ОПУБЛИКОВАТЬ ${clean(article, 255)}`;
}

export function confirmsUgcPublish(article: string, value: unknown) {
  return clean(value, 300) === ugcPublishPhrase(article);
}

export function ugcAvatar(avatarId: UgcAvatarId) {
  return UGC_AVATARS.find((avatar) => avatar.id === avatarId) ?? UGC_AVATARS[0];
}
