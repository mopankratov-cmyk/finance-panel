const CACHE_PREFIX = "finance-panel:report-cache:v1:";
const MAX_CACHE_ENTRIES = 24;

export interface BrowserReportCacheEntry<T> {
  savedAt: number;
  data: T;
}

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function browserStorages(): Storage[] {
  if (typeof window === "undefined") return [];
  const storages: Storage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Некоторые браузеры запрещают даже чтение свойства localStorage.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // В таком режиме отчёт просто загрузится из API при первом открытии.
  }
  return storages;
}

function parseEntry<T>(raw: string | null): BrowserReportCacheEntry<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserReportCacheEntry<T>>;
    if (!Number.isFinite(parsed.savedAt) || parsed.data == null) return null;
    return { savedAt: Number(parsed.savedAt), data: parsed.data };
  } catch {
    return null;
  }
}

/**
 * Постоянный браузерный снимок отчёта. Он намеренно не протухает по таймеру:
 * пересчёт выполняется только явной кнопкой «Обновить». Дата снимка всегда
 * показывается рядом с кнопкой, поэтому старые данные не выдаются за свежие.
 */
export function readBrowserReportCache<T>(key: string): BrowserReportCacheEntry<T> | null {
  for (const storage of browserStorages()) {
    try {
      const entry = parseEntry<T>(storage.getItem(cacheKey(key)));
      if (entry) return entry;
    } catch {
      // Запрет storage не должен ломать сам отчёт.
    }
  }
  return null;
}

function pruneReportCache(storage: Storage): void {
  const entries: Array<{ key: string; savedAt: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    entries.push({ key, savedAt: parseEntry<unknown>(storage.getItem(key))?.savedAt ?? 0 });
  }
  entries
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(MAX_CACHE_ENTRIES)
    .forEach((entry) => storage.removeItem(entry.key));
}

export function writeBrowserReportCache<T>(key: string, data: T): BrowserReportCacheEntry<T> {
  const entry = { savedAt: Date.now(), data };
  const serialized = JSON.stringify(entry);
  for (const storage of browserStorages()) {
    try {
      storage.setItem(cacheKey(key), serialized);
      pruneReportCache(storage);
    } catch {
      // localStorage может быть запрещён или переполнен; sessionStorage остаётся резервом.
    }
  }
  return entry;
}

export function reportCacheKey(scope: string, parts: readonly string[]): string {
  return [scope, ...parts.map((part) => encodeURIComponent(part))].join(":");
}
