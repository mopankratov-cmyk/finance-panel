"use client";

import { CheckCircle2, ClipboardList, Loader2 } from "lucide-react";
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
              <div key={task.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_150px] md:items-center">
                <div>
                  <p className="text-sm font-medium text-slate-900">{task.text}</p>
                  <p className="mt-1 text-xs text-slate-500">{task.author_name ?? "Руководитель"} · {new Date(task.created_at).toLocaleString("ru-RU")}</p>
                </div>
                <select value={task.status} onChange={(event) => void changeStatus(task, event.target.value as FinanceTask["status"])} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-medium">
                  {(Object.keys(labels) as FinanceTask["status"][]).map((status) => <option key={status} value={status}>{labels[status]}</option>)}
                </select>
              </div>
            ))}
          </div>}
      </div>
    </Card>
  );
}
