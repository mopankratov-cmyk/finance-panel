import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', '.collection-state.json');

// Те же 3 слота, что и в apps-script/Dashboard.gs (TIME_SLOTS) — список
// синхронизируется руками, это два независимых репозитория без общего
// импорта (Apps Script и Node.js). Порядок важен: по возрастанию часа.
export const SLOTS = [
  { label: '10:00', hour: 10, minute: 0 },
  { label: '18:00', hour: 18, minute: 0 },
  { label: '22:00', hour: 22, minute: 0 }
];

function moscowNow() {
  // Europe/Moscow сейчас фиксированный UTC+3 круглый год (Россия отменила
  // переход на летнее/зимнее время в 2014), но берём через Intl, а не
  // хардкодим смещение — на случай будущих изменений часового пояса.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute'))
  };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Первый ещё не собранный сегодня слот, чьё номинальное время уже наступило
 * (по Europe/Moscow) — или null, если собирать сейчас нечего (наступившие
 * слоты уже собраны, либо ни один ещё не наступил). Рассчитан на то, что
 * launchd дёргает collector.js часто (см. plist, раз в 15 минут): почти все
 * запуски ничего не делают (дешёвая проверка без браузера), а если Mac был
 * выключен/спал во время планового часа — сбор произойдёт при ближайшей
 * проверке после включения, а не потеряется совсем. Правило "не больше 3
 * реальных сборов в день" соблюдается всегда — по одной отметке на слот.
 */
export function getDueSlot() {
  const now = moscowNow();
  const state = loadState();
  const doneToday = state[now.dateStr] || [];
  const nowMinutes = now.hour * 60 + now.minute;

  for (const slot of SLOTS) {
    if (doneToday.includes(slot.label)) continue;
    var slotMinutes = slot.hour * 60 + slot.minute;
    if (nowMinutes >= slotMinutes) return slot;
    break; // слоты по возрастанию часа — дальше ещё не наступили
  }
  return null;
}

/**
 * Отмечает слот собранным на сегодня — независимо от того, все ли артикулы
 * реально собрались (частичные ошибки/антибот-блокировка внутри одного
 * слота не должны запускать немедленный повторный прогон каждые 15 минут —
 * это только усугубит антибот-блокировку, см. ANTIBOT_BACKOFF_MS в
 * collector.js). Следующая попытка — на следующем слоте через несколько часов.
 */
export function markSlotDone(slot) {
  const now = moscowNow();
  const state = loadState();
  if (!state[now.dateStr]) state[now.dateStr] = [];
  if (!state[now.dateStr].includes(slot.label)) state[now.dateStr].push(slot.label);

  // Не даём файлу расти бесконечно — храним только последние 14 дней.
  var cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  Object.keys(state).forEach((d) => {
    if (d < cutoff) delete state[d];
  });

  saveState(state);
}
