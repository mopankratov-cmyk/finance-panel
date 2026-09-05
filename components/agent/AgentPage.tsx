"use client";

import { AlertTriangle, Bot, Info, Send, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "@/lib/analytics/format";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { normalizeSeverity, SEVERITY_LABEL, type SeverityTier } from "@/lib/agent/severity";
import type { AgentInsight } from "@/app/api/agent/insights/route";

const SEVERITY: Record<SeverityTier, { color: string; icon: typeof Info }> = {
  critical: { color: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
  warning: { color: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
  info: { color: "border-slate-200 bg-slate-50 text-slate-600", icon: Info },
};

export function AgentPage() {
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityTier | "">("");
  const [moduleFilter, setModuleFilter] = useState("");

  const [cabId, setCabId] = useActiveCabinet("wb");
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [chatting, setChatting] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const loadInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/insights", { cache: "no-store" });
      const json = await res.json();
      if (!json.error) setInsights(json.data ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadInsights();
    // пометить прочитанными при заходе на страницу
    fetch("/api/agent/insights", { method: "PATCH", body: "{}" }).catch(() => {});
  }, [loadInsights]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const modules = useMemo(() => [...new Set(insights.map((i) => i.module))].sort(), [insights]);
  const filteredInsights = useMemo(() => insights.filter((i) =>
    (!severityFilter || normalizeSeverity(i.severity) === severityFilter) &&
    (!moduleFilter || i.module === moduleFilter)
  ), [insights, severityFilter, moduleFilter]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analyze", cabinet: cabId || undefined }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else await loadInsights();
    } catch {
      setError("Ошибка запроса к агенту");
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || chatting) return;
    setChat((c) => [...c, { role: "user", text: q }]);
    setQuestion("");
    setChatting(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "chat", question: q, cabinet: cabId || undefined }),
      });
      const json = await res.json();
      setChat((c) => [...c, { role: "assistant", text: json.answer ?? json.error ?? "—" }]);
    } catch {
      setChat((c) => [...c, { role: "assistant", text: "Ошибка запроса" }]);
    } finally {
      setChatting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
            <Bot className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI-агент</h1>
            <p className="text-sm text-slate-400">Анализ аномалий и рекомендации по данным WB</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
        <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Sparkles className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
          {analyzing ? "Анализирую..." : "Запустить разбор"}
        </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Инсайты */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Инсайты</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-md bg-slate-100 p-0.5">
                {([["", "Все"], ["critical", SEVERITY_LABEL.critical], ["warning", SEVERITY_LABEL.warning], ["info", SEVERITY_LABEL.info]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setSeverityFilter(v)}
                    className={`tap-row inline-flex items-center rounded px-3 py-1 text-xs font-semibold sm:px-2.5 ${severityFilter === v ? "bg-white text-violet-700 shadow" : "text-slate-500"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {modules.length > 1 && (
                <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}
                  className="tap-row rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600">
                  <option value="">Все модули</option>
                  {modules.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
          </div>
          {filteredInsights.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              {insights.length === 0 ? "Нет инсайтов. Запустите разбор." : "Нет инсайтов по фильтру."}
            </div>
          ) : (
            filteredInsights.map((i) => {
              const sev = SEVERITY[normalizeSeverity(i.severity)];
              const Icon = sev.icon;
              return (
                <div key={i.id} className={`rounded-xl border p-4 ${sev.color}`}>
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{i.title}</p>
                        <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] uppercase">{i.module}</span>
                      </div>
                      <p className="mt-1 text-sm opacity-90">{i.body}</p>
                      <p className="mt-1 text-[11px] opacity-60">{formatTime(i.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Чат */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-100 p-4 text-lg font-semibold text-slate-900">Чат с агентом</h2>
          {/* Высота окна чата — в долях экрана, а не в жёстких пикселях: 480px
              на iPhone SE забирали весь экран, и поднятая клавиатура оставляла
              от переписки полосу в пару строк. */}
          <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 min-h-[40dvh] max-h-[50dvh] lg:min-h-[280px] lg:max-h-[480px]">
            {chat.length === 0 && (
              <p className="text-sm text-slate-400">
                Спросите, например: «Где растёт ДРР?» или «Что срочно дозаказать?»
              </p>
            )}
            {chat.map((m, idx) => (
              <div
                key={idx}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-violet-600 text-white"
                    : "bg-slate-100 text-slate-700 whitespace-pre-wrap"
                }`}
              >
                {m.text}
              </div>
            ))}
            {chatting && <div className="text-sm text-slate-400">Агент думает...</div>}
            <div ref={chatEnd} />
          </div>
          {/* action-bar отступает и на системный индикатор, и на клавиатуру —
              иначе поле ввода уезжает под неё вместе с потоком страницы. */}
          <div className="action-bar flex gap-2 rounded-b-xl border-t border-slate-100 p-3">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="Вопрос по данным..."
              enterKeyHint="send"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              onClick={ask}
              disabled={chatting || !question.trim()}
              aria-label="Отправить вопрос"
              className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
