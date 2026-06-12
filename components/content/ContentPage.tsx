"use client";

import { Check, Copy, FlaskConical, ImageIcon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContentProduct } from "@/app/api/content/route";

interface Variant {
  label: string;
  title: string;
  rationale: string;
}
interface GeneratedContent {
  title: string;
  description: string;
  keywords: string[];
  variants: Variant[];
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
    >
      {done ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {done ? "Скопировано" : "Копировать"}
    </button>
  );
}

export function ContentPage() {
  const [products, setProducts] = useState<ContentProduct[]>([]);
  const [article, setArticle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [funnel, setFunnel] = useState<Record<string, number> | null>(null);

  const [aspect, setAspect] = useState("3:4");
  const [fromCard, setFromCard] = useState(true);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; prompt: string; referenceUrl?: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/content")
      .then((r) => r.json())
      .then((j) => setProducts(j.data ?? []))
      .catch(() => {});
  }, []);

  const generate = async () => {
    const p = products.find((x) => x.article === article);
    if (!p) return;
    setLoading(true);
    setError(null);
    setContent(null);
    setFunnel(null);
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article: p.article, name: p.name, nmId: p.nmId }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setContent(json.content);
        setFunnel(json.funnel);
      }
    } catch {
      setError("Ошибка генерации");
    } finally {
      setLoading(false);
    }
  };

  const generateImage = async () => {
    const p = products.find((x) => x.article === article);
    if (!p) return;
    setImgLoading(true);
    setImgError(null);
    setImage(null);
    try {
      const res = await fetch("/api/content/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: p.article,
          name: p.name,
          nmId: p.nmId,
          aspectRatio: aspect,
          fromCard: fromCard && p.nmId != null,
        }),
      });
      const json = await res.json();
      if (json.error) setImgError(json.error);
      else setImage({ url: json.imageUrl, prompt: json.prompt, referenceUrl: json.referenceUrl });
    } catch {
      setImgError("Ошибка генерации фото");
    } finally {
      setImgLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
          <FlaskConical className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Контент-лаборатория</h1>
          <p className="text-sm text-slate-400">AI-генерация текста карточки и A/B-варианты заголовка</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm text-slate-600">
          Товар
          <select
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            className="mt-1 block w-72 rounded border border-slate-200 px-2 py-1.5 text-sm"
          >
            <option value="">— выбрать —</option>
            {products.map((p) => (
              <option key={p.article} value={p.article}>
                {p.article} {p.name ? `· ${p.name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={generate}
          disabled={loading || !article}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Sparkles className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
          {loading ? "Генерирую..." : "Сгенерировать"}
        </button>
      </div>

      {/* Фото карточки через Higgsfield */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-violet-600" />
            <h3 className="font-semibold text-slate-900">Фото карточки (Higgsfield)</h3>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={fromCard}
                onChange={(e) => setFromCard(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              из фото карточки
            </label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="3:4">3:4 (карточка)</option>
              <option value="1:1">1:1 (квадрат)</option>
              <option value="9:16">9:16 (сторис)</option>
            </select>
            <button
              onClick={generateImage}
              disabled={imgLoading || !article}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <ImageIcon className={`h-4 w-4 ${imgLoading ? "animate-pulse" : ""}`} />
              {imgLoading ? "Рисую..." : "Сгенерировать фото"}
            </button>
          </div>
        </div>

        {imgError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {imgError}
          </div>
        )}

        {image && (
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            {image.referenceUrl && (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.referenceUrl}
                  alt="исходное фото"
                  className="w-full max-w-[160px] rounded-lg border border-slate-200 object-cover"
                />
                <p className="mt-1 text-xs text-slate-400">исходник карточки</p>
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={article}
              className="w-full max-w-xs rounded-lg border border-slate-200 object-cover"
            />
            <div className="flex-1 space-y-2">
              <p className="text-xs uppercase text-slate-400">Промпт</p>
              <p className="text-sm text-slate-600">{image.prompt}</p>
              <div className="flex gap-2 pt-1">
                <a
                  href={image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Открыть оригинал
                </a>
                <CopyButton text={image.url} />
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {content && (
        <div className="space-y-4">
          {funnel && (
            <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span>Показы: <b>{funnel.openCard}</b></span>
              <span>CV корзина: <b>{funnel.cartRatePct}%</b></span>
              <span>CR заказ: <b>{funnel.orderRatePct}%</b></span>
              <span>% выкупа: <b>{funnel.buyoutRatePct}%</b></span>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Заголовок</h3>
              <CopyButton text={content.title} />
            </div>
            <p className="mt-2 text-slate-800">{content.title}</p>
            <p className="mt-1 text-xs text-slate-400">{content.title.length} символов</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Описание</h3>
              <CopyButton text={content.description} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{content.description}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Ключевые слова</h3>
              <CopyButton text={content.keywords.join(", ")} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {content.keywords.map((k, i) => (
                <span key={i} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700">
                  {k}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="font-semibold text-slate-900">A/B-варианты заголовка</h3>
            <div className="mt-3 space-y-3">
              {content.variants.map((v, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] uppercase text-slate-500">
                      {v.label}
                    </span>
                    <CopyButton text={v.title} />
                  </div>
                  <p className="mt-2 font-medium text-slate-800">{v.title}</p>
                  <p className="mt-1 text-xs text-slate-400">{v.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
