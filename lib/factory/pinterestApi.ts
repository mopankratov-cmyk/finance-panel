const API_BASE = "https://api.pinterest.com/v5";

export type PinterestUploadRegistration = {
  media_id: string;
  upload_url: string;
  upload_parameters: Record<string, string>;
};

export type PinterestMediaDetails = {
  media_id: string;
  status: string;
};

export type PinterestPin = {
  id: string;
  title?: string | null;
  description?: string | null;
  link?: string | null;
  media?: {
    media_type?: string | null;
    images?: Record<string, { url?: string | null }>;
  } | null;
  creative_type?: string | null;
};

type PinterestPinAnalytics = Record<string, {
  summary_metrics?: Record<string, number | null | undefined>;
}>;

function auth(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function text(value: unknown, max = 500): string | null {
  const cleaned = String(value || "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch<T>(path: string, init: RequestInit & { token: string }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...auth(init.token),
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(text((body as Record<string, unknown>)?.message || (body as Record<string, unknown>)?.code || res.statusText, 220) || `Pinterest ${res.status}`);
  }
  return body as T;
}

export async function pinterestGetBoard(token: string, boardId: string): Promise<Record<string, unknown>> {
  return jsonFetch(`/boards/${encodeURIComponent(boardId)}`, { method: "GET", token });
}

export async function pinterestRegisterVideoUpload(token: string): Promise<PinterestUploadRegistration> {
  const response = await jsonFetch<Record<string, unknown>>("/media", {
    method: "POST",
    token,
    body: JSON.stringify({ media_type: "video" }),
  });
  return {
    media_id: text(response.media_id, 120) || "",
    upload_url: text(response.upload_url, 2000) || "",
    upload_parameters: (response.upload_parameters && typeof response.upload_parameters === "object"
      ? Object.fromEntries(Object.entries(response.upload_parameters as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]))
      : {}),
  };
}

export async function pinterestUploadVideoAsset(upload: PinterestUploadRegistration, media: Blob, filename: string): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.upload_parameters)) form.set(key, value);
  form.set("file", media, filename);
  const res = await fetch(upload.upload_url, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Pinterest media upload failed: ${res.status}`);
}

export async function pinterestGetMedia(token: string, mediaId: string): Promise<PinterestMediaDetails> {
  const response = await jsonFetch<Record<string, unknown>>(`/media/${encodeURIComponent(mediaId)}`, { method: "GET", token });
  return {
    media_id: text(response.media_id, 120) || mediaId,
    status: text(response.status, 80) || "unknown",
  };
}

export async function pinterestWaitForMediaReady(token: string, mediaId: string, maxAttempts = 12): Promise<PinterestMediaDetails> {
  let last: PinterestMediaDetails = { media_id: mediaId, status: "unknown" };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await pinterestGetMedia(token, mediaId);
    if (last.status.toLowerCase() === "succeeded") return last;
    if (["failed", "error", "cancelled"].includes(last.status.toLowerCase())) {
      throw new Error(`Pinterest media status ${last.status}`);
    }
    await sleep(attempt < 4 ? 2000 : 4000);
  }
  throw new Error(`Pinterest media upload timed out with status ${last.status}`);
}

export async function pinterestCreateVideoPin(input: {
  token: string;
  boardId: string;
  title: string;
  description: string;
  link?: string | null;
  mediaId: string;
  coverImageUrl: string;
}): Promise<PinterestPin> {
  const body: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    board_id: input.boardId,
    media_source: {
      source_type: "video_id",
      media_id: input.mediaId,
      cover_image_url: input.coverImageUrl,
    },
  };
  if (input.link) body.link = input.link;
  return jsonFetch<PinterestPin>("/pins", {
    method: "POST",
    token: input.token,
    body: JSON.stringify(body),
  });
}

export async function pinterestGetPinAnalytics(input: {
  token: string;
  pinId: string;
  startDate: string;
  endDate: string;
  metricTypes: string[];
}): Promise<Record<string, number | null | undefined>> {
  const params = new URLSearchParams();
  params.set("pin_ids", input.pinId);
  params.set("start_date", input.startDate);
  params.set("end_date", input.endDate);
  for (const metric of input.metricTypes) params.append("metric_types", metric);
  const response = await jsonFetch<PinterestPinAnalytics>(`/pins/analytics?${params.toString()}`, { method: "GET", token: input.token });
  const row = response[input.pinId] || (Object.values(response)[0] as { summary_metrics?: Record<string, number | null | undefined> } | undefined);
  return row?.summary_metrics || {};
}
