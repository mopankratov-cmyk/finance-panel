"use client";

import { useEffect, useMemo, useState } from "react";
import { wbCardImageUrlsForDisplay } from "@/lib/wb/cardImage";

interface WbProductImageProps {
  nm?: number | null;
  src?: string | null;
  alt?: string;
  className: string;
  loading?: "eager" | "lazy";
  size?: string;
}

export function WbProductImage({ nm, src, alt = "", className, loading = "lazy", size = "c246x328" }: WbProductImageProps) {
  const urls = useMemo(() => wbCardImageUrlsForDisplay({ nmId: nm, src, size }), [nm, size, src]);
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [src, nm, size]);

  if (!urls[index]) return <span aria-hidden="true" className={className} />;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={urls[index]} alt={alt} loading={loading} className={className} onError={() => setIndex((current) => current + 1)} />;
}
