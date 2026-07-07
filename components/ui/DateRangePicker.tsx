"use client";

// Произвольный диапазон дат в дополнение к пресетам (7/14/30д) — как date-инпуты
// в infernoff.ru/wb рядом с "Сегодня/Вчера/Неделя/Этот месяц". Пусто = используется пресет.
export function DateRangePicker({ from, to, onChange }: {
  from: string; to: string; onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-violet-500 focus:outline-none" />
      <span className="text-xs text-gray-400">—</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-violet-500 focus:outline-none" />
      {(from || to) && (
        <button onClick={() => onChange("", "")} className="text-xs text-gray-400 underline hover:text-violet-600">сброс</button>
      )}
    </div>
  );
}
