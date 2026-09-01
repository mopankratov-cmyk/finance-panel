"use client";

import { CheckCircle2, ClipboardList, Loader2, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";

interface FinanceTask {
  id: number;
  text: string;
  status: "new" | "in_progress" | "done" | "cancelled";
  source: string;
  author_name: string | null;
  result_text: string | null;
  created_at: string;
}

const labels = { new: "Новая", in_progress: "В работе", done: "Выполнена", cancelled: "Отменена" };

export function FinanceTasksPanel() {
  const [tasks, setTasks] = useState<FinanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = async () => {
    const response = await fetch("/api/opiu/tasks", { cache: "no-store" });
    if (!response.ok) {
      setConfigured(false);
      setLoading(false);
      return;
    }
    const body = await response.json() as { tasks: FinanceTask[] };
    setTasks(body.tasks);
    setConfigured(true);
    setLoading(false);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const changeStatus = async (task: FinanceTask, status: FinanceTask["status"]) => {
    const response = await fetch("/api/opiu/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status }),
    });
    if (response.ok) setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status } : item));
  };

  const answerAndClose = async (task: FinanceTask) => {
    const resultText = answers[task.id]?.trim();
    if (!resultText) return;
    setSavingId(task.id);
    const response = await fetch("/api/opiu/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status: "done", resultText }),
    });
    if (response.ok) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: "done", result_text: resultText } : item));
      setAnswers((current) => ({ ...current, [task.id]: "" }));
    }
    setSavingId(null);
  };

  const deleteTask = async (task: FinanceTask) => {
    if (!window.confirm("Удалить эту задачу? Действие нельзя отменить.")) return;
    setSavingId(task.id);
    const response = await fetch(`/api/opiu/tasks?id=${task.id}`, { method: "DELETE" });
    if (response.ok) setTasks((current) => current.filter((item) => item.id !== task.id));
    setSavingId(null);
  };

  const moveToPaymentAnswer = async (task: FinanceTask) => {
    if (!window.confirm("Перенести текст этой задачи в последний платёж, который ждёт ответа руководителя?")) return;
    setSavingId(task.id);
    const response = await fetch("/api/opiu/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, action: "move_to_payment_answer" }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (response.ok) setTasks((current) => current.filter((item) => item.id !== task.id));
    else window.alert(result?.error || "Не удалось перенести ответ к платежу");
    setSavingId(null);
  };

  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><ClipboardList className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Задачи руководителя</h2>
          <p className="text-sm text-slate-500">Сообщения из финансового Telegram-бота.</p>
        </div>
      </div>
      <div className="p-5">
        {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Загружаю задачи…</p>
          : !configured ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Появится после выполнения SQL и подключения Telegram владельцем.</p>
          : tasks.length === 0 ? <p className="flex items-center gap-2 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Новых задач нет.</p>
          : <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_180px] md:items-start">
                <div>
                  <p className="text-sm font-medium text-slate-900">{task.text}</p>
                  <p className="mt-1 text-xs text-slate-500">{task.author_name ?? "Руководитель"} · {new Date(task.created_at).toLocaleString("ru-RU")}</p>
                  {task.result_text && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900"><b>Ответ:</b> {task.result_text}</p>}
                  {task.status !== "done" && task.status !== "cancelled" && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={answers[task.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="Ответ руководителю" aria-label={`Ответ на задачу ${task.id}`} className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                    <button disabled={savingId === task.id || !answers[task.id]?.trim()} onClick={() => void answerAndClose(task)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" /> Ответить и закрыть</button>
                  </div>}
                  {task.source === "telegram" && task.status === "new" && <button disabled={savingId === task.id} onClick={() => void moveToPaymentAnswer(task)} className="mt-2 min-h-11 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">Это ответ на платёж</button>}
                </div>
                <div className="flex gap-2 md:flex-col">
                  <select value={task.status} onChange={(event) => void changeStatus(task, event.target.value as FinanceTask["status"])} className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-medium">
                    {(Object.keys(labels) as FinanceTask["status"][]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}
                  </select>
                  <button disabled={savingId === task.id} onClick={() => void deleteTask(task)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /> Удалить</button>
                </div>
              </div>
            ))}
          </div>}
      </div>
    </Card>
  );
}
