const QUEUE = "https://queue.fal.run/";
const NANO_EDIT = "fal-ai/nano-banana/edit";

export async function fetchWithRetry(url: string, init: RequestInit = {}, tries = 4): Promise<Response> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1200 * i));
    }
  }
  throw last;
}

export async function runNanoBananaEdit(input: {
  image: string;
  prompt: string;
  maxWaitMs?: number;
}): Promise<{ ok: true; imageUrl: string; responseUrl: string } | { ok: false; error: string; responseUrl?: string }> {
  const key = process.env.FAL_KEY || "";
  if (!key) return { ok: false, error: "FAL_KEY не настроен" };
  const sub = await fetchWithRetry(`${QUEUE}${NANO_EDIT}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      image_urls: [input.image],
      prompt: input.prompt,
      num_images: 1,
      aspect_ratio: "9:16",
      safety_tolerance: "6",
      output_format: "png",
    }),
  }, 4);
  if (!sub.ok) return { ok: false, error: `fal submit ${sub.status}: ${(await sub.text()).slice(0, 220)}` };
  const sj = await sub.json() as { response_url?: string };
  const responseUrl = sj.response_url || "";
  if (!responseUrl) return { ok: false, error: "fal submit без response_url" };

  const deadline = Date.now() + (input.maxWaitMs || 230_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await fetchWithRetry(`${responseUrl}/status`, { headers: { Authorization: `Key ${key}` }, cache: "no-store" }, 3);
    if (st.ok) {
      const s = await st.json() as { status?: string };
      if (s.status === "COMPLETED") break;
    }
  }

  for (let i = 0; i < 8; i++) {
    const res = await fetchWithRetry(responseUrl, { headers: { Authorization: `Key ${key}` }, cache: "no-store" }, 3);
    const text = await res.text();
    if (res.ok) {
      const rj = JSON.parse(text) as { images?: { url?: string }[] };
      const imageUrl = rj.images?.[0]?.url || "";
      if (imageUrl) return { ok: true, imageUrl, responseUrl };
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { ok: false, error: "clean result не созрел", responseUrl };
}

