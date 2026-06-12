"use client";

import { AlertTriangle, Bot, Info, Send, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/analytics/format";
import type { AgentInsight } from "@/app/api/agent/insights/route";

const SEVERITY: Record<string, { color: string; icon: typeof Info }> = {
  critical: { color: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
  warning: { color: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
  info: { color: "border-slate-200 bg-slate-50 text-slate-600", icon: Info },
};

export function AgentPage() {
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "analyze" }),
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
        body: JSON.stringify({ mode: "chat", question: q }),
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
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          <Sparkles className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
          {analyzing ? "Анализирую..." : "Запустить разбор"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Инсайты */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Инсайты</h2>
          {insights.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              Нет инсайтов. Запустите разбор.
            </div>
          ) : (
            insights.map((i) => {
              const sev = SEVERITY[i.severity] ?? SEVERITY.info;
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
          <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ minHeight: 280, maxHeight: 480 }}>
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
          <div className="flex gap-2 border-t border-slate-100 p-3">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="Вопрос по данным..."
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              onClick={ask}
              disabled={chatting || !question.trim()}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
