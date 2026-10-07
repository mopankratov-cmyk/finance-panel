import { ChinaLinksPage } from "@/components/assortment/ChinaLinksPage";
import { parseDirection } from "@/lib/assortment/constants";

/** «Китайские площадки — ссылки» по нишам «Китай (1688)»: без сбора и без ключа, доступна всегда. ?direction=jackets|bags — сразу раздел. */
export default async function AssortmentChinaLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).direction;
  const direction = parseDirection(Array.isArray(raw) ? raw[0] : raw);
  return <ChinaLinksPage key={direction ?? "all"} initialFilter={direction ?? "all"} />;
}
