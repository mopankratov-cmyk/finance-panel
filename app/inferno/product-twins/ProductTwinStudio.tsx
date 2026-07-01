"use client";

import {
  BadgeCheck,
  Boxes,
  Eye,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SourcePackReadiness = {
  supported: boolean;
  ok: boolean;
  category: string;
  sourceDisk?: string;
  sourceRoot?: string;
  presentRoles: string[];
  missingRoles: string[];
  primarySourcePath?: string;
  error?: string;
};

type InventoryItem = {
  article: string;
  product: string;
  category: string;
  best_source?: { path?: string; score?: number; reasons?: string[] } | null;
  readiness?: { hasSource?: boolean; hasStrongSource?: boolean; canBuildCleanTwin?: boolean };
  source_pack_readiness?: SourcePackReadiness;
  sourcePackReadiness?: SourcePackReadiness;
};

type TwinAsset = {
  assetId?: string;
  kind: string;
  url: string;
  preview_url?: string;
  previewUrl?: string;
  qualityScore?: number;
  risk?: string;
  brollReady?: boolean;
  heroReady?: boolean;
  marketplaceSafe?: boolean;
};

type Twin = {
  twinId: string;
  article: string;
  productName: string;
  category: string;
  status: string;
  qualityScore: number;
  sourcePath?: string;
  assets: TwinAsset[];
};

type TwinViewAsset = {
  article: string;
  twinId: string;
  viewId: string;
  label: string;
  purpose: string;
  truth: string;
  sourceAssetId?: string;
  url: string;
  preview_url?: string;
  previewUrl?: string;
  path?: string;
  createdAt?: string;
};

type BrollVerdict = "winner" | "usable" | "weak" | "reject";

type RunLog = {
  at: string;
  action: string;
  ok: boolean;
  message: string;
};

const DEFAULT_ARTICLES = "NV-08,NV-836,NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102";
const REQUIRED_BASE_ASSETS = ["clean_png", "white_bg", "gray_bg", "shadow_bg", "upscaled"];
const REQUIRED_SERVICE_ASSETS = ["object_mask", "alpha", "depth_map", "segmentation"];

type TwinReadiness = {
  status: "ready" | "review" | "missing";
  baseReady: number;
  serviceReady: number;
  derivedReady: number;
  missing: string[];
  warnings: string[];
};

function splitArticles(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

function roleCount(item: InventoryItem): string {
  const readiness = item.source_pack_readiness || item.sourcePackReadiness;
  if (!readiness?.supported) return "not supported";
  return `${readiness.presentRoles?.length || 0}/${(readiness.presentRoles?.length || 0) + (readiness.missingRoles?.length || 0)}`;
}

function statusClass(ok?: boolean): string {
  if (ok) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function assetPreviewUrl(asset: TwinAsset): string {
  if (asset.preview_url || asset.previewUrl) return asset.preview_url || asset.previewUrl || "";
  if (asset.url?.startsWith("yandex-disk:")) return `/api/factory/product-twin/asset-preview?url=${encodeURIComponent(asset.url)}`;
  return asset.url;
}

function viewPreviewUrl(view: TwinViewAsset): string {
  if (view.preview_url || view.previewUrl) return view.preview_url || view.previewUrl || "";
  if (view.url?.startsWith("yandex-disk:")) return `/api/factory/product-twin/asset-preview?url=${encodeURIComponent(view.url)}`;
  return view.url;
}

function requiredDerivedViewCount(category?: string): number {
  if (category === "apparel" || category === "bag") return 5;
  if (category === "cosmetics" || category === "toy") return 4;
  return 3;
}

function getTwinReadiness(twin: Twin | null, viewAssets: TwinViewAsset[]): TwinReadiness {
  if (!twin) {
    return { status: "missing", baseReady: 0, serviceReady: 0, derivedReady: viewAssets.length, missing: ["twin"], warnings: [] };
  }
  const kinds = new Set((twin.assets || []).map((asset) => asset.kind));
  const missingBase = REQUIRED_BASE_ASSETS.filter((kind) => !kinds.has(kind));
  const missingService = REQUIRED_SERVICE_ASSETS.filter((kind) => !kinds.has(kind));
  const derivedTarget = requiredDerivedViewCount(twin.category);
  const missingDerived = Math.max(0, derivedTarget - viewAssets.length);
  const warnings: string[] = [];
  if (Number(twin.qualityScore || 0) < 0.7) warnings.push("quality below 0.70");
  if (!(twin.assets || []).some((asset) => asset.brollReady)) warnings.push("no b-roll ready asset");
  const missing = [...missingBase, ...missingService, ...(missingDerived ? [`${missingDerived} derived views`] : [])];
  const status = missing.length ? "missing" : warnings.length ? "review" : "ready";
  return {
    status,
    baseReady: REQUIRED_BASE_ASSETS.length - missingBase.length,
    serviceReady: REQUIRED_SERVICE_ASSETS.length - missingService.length,
    derivedReady: viewAssets.length,
    missing,
    warnings,
  };
}

function readinessClass(status: TwinReadiness["status"]): string {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "review") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export default function ProductTwinStudio() {
  const [articles, setArticles] = useState(DEFAULT_ARTICLES);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [twins, setTwins] = useState<Record<string, Twin | null>>({});
  const [views, setViews] = useState<Record<string, TwinViewAsset[]>>({});
  const [selected, setSelected] = useState<string>("NV-08");
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<RunLog[]>([]);

  const selectedTwin = twins[selected] || null;
  const selectedViews = views[selected] || [];
  const selectedReadiness = getTwinReadiness(selectedTwin, selectedViews);
  const selectedItem = items.find((item) => item.article === selected) || null;
  const articleList = useMemo(() => splitArticles(articles), [articles]);
  const readyCount = items.filter((item) => (item.source_pack_readiness || item.sourcePackReadiness)?.ok).length;

  function pushLog(action: string, ok: boolean, message: string) {
    setLogs((prev) => [{ at: new Date().toLocaleTimeString("ru-RU"), action, ok, message }, ...prev].slice(0, 8));
  }

  async function loadInventory() {
    setBusy("inventory");
    try {
      const qs = new URLSearchParams({ articles: articleList.join(","), candidate_limit: "4", probe_limit: "4" });
      const data = await jsonFetch(`/api/factory/product-twin/inventory?${qs.toString()}`);
      const next = (data.items || []) as InventoryItem[];
      setItems(next);
      if (!next.some((item) => item.article === selected)) setSelected(next[0]?.article || "");
      pushLog("inventory", true, `${next.length} products loaded`);
    } catch (e) {
      pushLog("inventory", false, String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  }

  async function applySourcePacks() {
    setBusy("apply");
    try {
      const data = await jsonFetch("/api/factory/product-twin/source-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: articleList, apply: true }),
      });
      pushLog("apply", true, `${data.inserted || 0} source-pack rows`);
      await loadInventory();
    } catch (e) {
      pushLog("apply", false, String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  }

  async function rebuildTwins() {
    setBusy("build");
    try {
      const data = await jsonFetch("/api/factory/product-twin/batch-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: articleList, build: true, limit: articleList.length }),
      });
      pushLog("build", Boolean(data.ok), `${data.count || 0} rebuild attempts`);
      await loadLatestTwins();
    } catch (e) {
      pushLog("build", false, String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  }

  async function loadLatestTwins() {
    setBusy("twins");
    try {
      const entries = await Promise.all(articleList.map(async (article) => {
        try {
          const data = await jsonFetch(`/api/factory/product-twin/by-article/${encodeURIComponent(article)}`);
          return [article, data.twin as Twin] as const;
        } catch {
          return [article, null] as const;
        }
      }));
      setTwins(Object.fromEntries(entries));
      await loadDerivedViews();
      pushLog("twins", true, "latest twins refreshed");
    } catch (e) {
      pushLog("twins", false, String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  }

  async function loadDerivedViews() {
    const entries = await Promise.all(articleList.map(async (article) => {
      try {
        const data = await jsonFetch(`/api/factory/product-twin/views?article=${encodeURIComponent(article)}&limit=80`);
        return [article, (data.views || []) as TwinViewAsset[]] as const;
      } catch {
        return [article, []] as const;
      }
    }));
    setViews(Object.fromEntries(entries));
  }

  async function sendBrollFeedback(input: {
    asset?: TwinAsset;
    view?: TwinViewAsset;
    verdict: BrollVerdict;
    reasons?: string[];
  }) {
    if (!selected) return;
    setBusy("feedback");
    try {
      const payload = {
        article: selected,
        twin_id: selectedTwin?.twinId || input.view?.twinId || null,
        asset_id: input.asset?.assetId || input.view?.sourceAssetId || null,
        view_id: input.view?.viewId || null,
        verdict: input.verdict,
        reasons: input.reasons || [],
      };
      const data = await jsonFetch("/api/factory/product-broll-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      pushLog("b-roll qa", true, `${data.feedback?.verdict || input.verdict} saved`);
    } catch (e) {
      pushLog("b-roll qa", false, String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                <Boxes className="h-4 w-4 text-cyan-700" />
                Product Twin Studio
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-normal text-slate-950 sm:text-3xl">
                Source packs, twins, visual review
              </h1>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <button
                onClick={loadInventory}
                disabled={Boolean(busy)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === "inventory" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
              <button
                onClick={applySourcePacks}
                disabled={Boolean(busy)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                Apply Packs
              </button>
              <button
                onClick={rebuildTwins}
                disabled={Boolean(busy)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-cyan-700 bg-cyan-700 px-3 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-50"
              >
                {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Rebuild
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_260px_260px]">
            <input
              value={articles}
              onChange={(e) => setArticles(e.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-cyan-700"
            />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-black">{readyCount}</span>
              <span className="text-slate-500"> / {items.length} source-pack ready</span>
            </div>
            <button
              onClick={loadLatestTwins}
              disabled={Boolean(busy)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === "twins" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Load Twins
            </button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[110px_1fr_100px_100px_1.3fr] border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <div>Article</div>
              <div>Product</div>
              <div>Type</div>
              <div>Roles</div>
              <div>Primary Source</div>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((item) => {
                const readiness = item.source_pack_readiness || item.sourcePackReadiness;
                return (
                  <button
                    key={item.article}
                    onClick={() => setSelected(item.article)}
                    className={`grid w-full grid-cols-[110px_1fr_100px_100px_1.3fr] items-center gap-2 px-3 py-3 text-left text-sm hover:bg-slate-50 ${selected === item.article ? "bg-cyan-50" : "bg-white"}`}
                  >
                    <div className="font-black text-slate-950">{item.article}</div>
                    <div className="min-w-0 truncate text-slate-700">{item.product}</div>
                    <div className="text-slate-600">{item.category}</div>
                    <div>
                      <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-black ${statusClass(readiness?.ok)}`}>
                        {roleCount(item)}
                      </span>
                    </div>
                    <div className="min-w-0 truncate font-mono text-xs text-slate-600">{readiness?.primarySourcePath || item.best_source?.path || "-"}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="grid gap-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-black">
                {(selectedItem?.source_pack_readiness || selectedItem?.sourcePackReadiness)?.ok ? (
                  <BadgeCheck className="h-5 w-5 text-emerald-700" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-amber-700" />
                )}
                {selected || "No selection"}
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                {(selectedItem?.source_pack_readiness || selectedItem?.sourcePackReadiness)?.presentRoles?.map((role) => (
                  <div key={role} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="font-medium text-slate-700">{role}</span>
                    <span className="text-xs font-bold text-emerald-700">ready</span>
                  </div>
                ))}
                {(selectedItem?.source_pack_readiness || selectedItem?.sourcePackReadiness)?.missingRoles?.map((role) => (
                  <div key={role} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <span className="font-medium text-amber-900">{role}</span>
                    <span className="text-xs font-bold text-amber-700">missing</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-black">
                <Sparkles className="h-5 w-5 text-cyan-700" />
                Latest Twin
              </div>
              {selectedTwin ? (
                <div className="mt-3 grid gap-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-slate-100 p-2"><b>quality</b><br />{selectedTwin.qualityScore}</div>
                    <div className="rounded-md bg-slate-100 p-2"><b>status</b><br />{selectedTwin.status}</div>
                  </div>
                  <div className={`rounded-md border p-3 text-xs ${readinessClass(selectedReadiness.status)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black uppercase tracking-[0.12em]">Asset Readiness</span>
                      <span className="font-black">{selectedReadiness.status}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded bg-white/70 px-2 py-1">
                        <b>{selectedReadiness.baseReady}/{REQUIRED_BASE_ASSETS.length}</b>
                        <br />base
                      </div>
                      <div className="rounded bg-white/70 px-2 py-1">
                        <b>{selectedReadiness.serviceReady}/{REQUIRED_SERVICE_ASSETS.length}</b>
                        <br />service
                      </div>
                      <div className="rounded bg-white/70 px-2 py-1">
                        <b>{selectedReadiness.derivedReady}/{requiredDerivedViewCount(selectedTwin.category)}</b>
                        <br />views
                      </div>
                    </div>
                    {(selectedReadiness.missing.length || selectedReadiness.warnings.length) ? (
                      <div className="mt-2 space-y-1 font-medium">
                        {selectedReadiness.missing.length ? <div>Missing: {selectedReadiness.missing.join(", ")}</div> : null}
                        {selectedReadiness.warnings.length ? <div>Review: {selectedReadiness.warnings.join(", ")}</div> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTwin.assets?.filter((asset) => ["clean_png", "shadow_bg", "white_bg", "upscaled"].includes(asset.kind)).slice(0, 4).map((asset) => (
                      <div key={`${asset.kind}-${asset.url}`} className="overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <a href={assetPreviewUrl(asset)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={assetPreviewUrl(asset)} alt={asset.kind} className="aspect-square w-full object-contain" />
                        </a>
                        <div className="truncate px-2 py-1 text-xs font-bold text-slate-700">{asset.kind}</div>
                        <div className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-white p-1">
                          <button
                            title="B-roll usable"
                            onClick={() => sendBrollFeedback({ asset, verdict: "usable" })}
                            disabled={Boolean(busy)}
                            className="inline-flex h-7 items-center justify-center rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="Weak b-roll"
                            onClick={() => sendBrollFeedback({ asset, verdict: "weak", reasons: ["boring_motion"] })}
                            disabled={Boolean(busy)}
                            className="inline-flex h-7 items-center justify-center rounded border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="Reject for b-roll"
                            onClick={() => sendBrollFeedback({ asset, verdict: "reject", reasons: ["packshot_only"] })}
                            disabled={Boolean(busy)}
                            className="inline-flex h-7 items-center justify-center rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  Twin not loaded
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black">
                  <Eye className="h-5 w-5 text-violet-700" />
                  Derived Views
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-700">{selectedViews.length}</span>
              </div>
              {selectedViews.length ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedViews.slice(0, 8).map((view) => (
                    <div
                      key={`${view.viewId}-${view.url}-${view.createdAt || ""}`}
                      className="overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                    >
                      <a href={viewPreviewUrl(view)} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={viewPreviewUrl(view)} alt={view.label || view.viewId} className="aspect-square w-full object-contain" />
                      </a>
                      <div className="px-2 py-1">
                        <div className="truncate text-xs font-black text-slate-800">{view.viewId}</div>
                        <div className="truncate text-[11px] font-medium text-slate-500">{view.purpose} · {view.truth}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-white p-1">
                        <button
                          title="B-roll usable"
                          onClick={() => sendBrollFeedback({ view, verdict: "usable" })}
                          disabled={Boolean(busy)}
                          className="inline-flex h-7 items-center justify-center rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Weak b-roll"
                          onClick={() => sendBrollFeedback({ view, verdict: "weak", reasons: ["boring_motion"] })}
                          disabled={Boolean(busy)}
                          className="inline-flex h-7 items-center justify-center rounded border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          title="Reject for b-roll"
                          onClick={() => sendBrollFeedback({ view, verdict: "reject", reasons: ["not_ad_ready"] })}
                          disabled={Boolean(busy)}
                          className="inline-flex h-7 items-center justify-center rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  Views not loaded
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-black">Run Log</div>
              <div className="mt-3 grid gap-2">
                {logs.map((log) => (
                  <div key={`${log.at}-${log.action}-${log.message}`} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black">{log.action}</span>
                      <span className={log.ok ? "text-emerald-700" : "text-rose-700"}>{log.ok ? "ok" : "fail"}</span>
                    </div>
                    <div className="mt-1 text-slate-600">{log.at} · {log.message}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
