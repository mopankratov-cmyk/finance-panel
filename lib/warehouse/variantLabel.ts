/** Как позиция называется в списках: артикул, а рядом размер — если он заведён.
 *  У безразмерного товара размер пустой, и подпись выглядит как раньше. */
export function variantLabel(article: string, sizeLabel: string | null | undefined): string {
  const size = String(sizeLabel ?? "").trim();
  const base = String(article ?? "").trim();
  return size ? `${base} · ${size}` : base;
}
