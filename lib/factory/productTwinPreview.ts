export function productTwinAssetPreviewUrl(url: string | null | undefined): string {
  const clean = String(url || "").trim();
  if (!clean) return "";
  if (clean.startsWith("yandex-disk:")) {
    return `/api/factory/product-twin/asset-preview?url=${encodeURIComponent(clean)}`;
  }
  return clean;
}

export function withProductTwinPreviewUrls<T extends { assets?: { url?: string; preview_url?: string; previewUrl?: string }[] }>(twin: T): T {
  return {
    ...twin,
    assets: (twin.assets || []).map((asset) => ({
      ...asset,
      preview_url: productTwinAssetPreviewUrl(asset.url),
      previewUrl: productTwinAssetPreviewUrl(asset.url),
    })),
  };
}
