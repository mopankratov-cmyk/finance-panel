"use client";

// Произвольный диапазон дат в дополнение к пресетам (7/14/30д) — как date-инпуты
// в infernoff.ru/wb рядом с "Сегодня/Вчера/Неделя/Этот месяц". Пусто = используется пресет.
export function DateRangePicker({ from, to, onChange }: {
  from: string; to: string; onChange: (from: string, to: string) => void;
}) {
  // Нативное поле даты на касании занимает ~115px и не ужимается (шрифт полей
  // принудительно 16px, иначе iOS увеличивает страницу). Два таких поля с тире и
  // «сбросом» в неразрывном ряду распирали шапку /seo и /rnp на всех телефонных
  // ширинах, поэтому ряд переносится, а поля делят строку пополам.
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)}
        className="min-w-0 flex-1 basis-[45%] rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-violet-500 focus:outline-none sm:flex-none sm:basis-auto" />
      <span className="text-xs text-gray-400">—</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)}
        className="min-w-0 flex-1 basis-[45%] rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-violet-500 focus:outline-none sm:flex-none sm:basis-auto" />
      {(from || to) && (
        <button onClick={() => onChange("", "")} className="tap-row inline-flex items-center px-2 text-xs text-gray-400 underline hover:text-violet-600">сброс</button>
      )}
    </div>
  );
}
