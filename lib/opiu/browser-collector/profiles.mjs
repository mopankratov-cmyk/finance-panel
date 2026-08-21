// Группировка целей по профилю браузера.
//
// Зачем: WB держит ОДНУ сессию продавца на профиль Chrome. Пять кабинетов в
// одном профиле не живут — вход в следующий выкидывает предыдущий, и сборщик
// молча снимал бы один и тот же кабинет пять раз. Поэтому у каждой цели свой
// профиль, если явно не сказано обратное.
//
// `profile` в targets.json — имя папки профиля. Его стоит задать руками, когда
// несколько кабинетов реально живут в одном аккаунте маркетплейса (у WB такие
// магазины переключаются селектором, повторный вход не нужен) — тогда они
// делят один профиль и один запуск браузера.

/** Имя профиля цели: явное значение или отдельный профиль на кабинет. */
export function profileNameOf(target) {
  const explicit = String(target?.profile ?? "").trim();
  if (explicit) return sanitizeProfileName(explicit);
  return sanitizeProfileName(`${target?.marketplace ?? "mp"}-${target?.cabinetId ?? "unknown"}`);
}

/**
 * Имя профиля становится именем папки, поэтому всё, что может увести запись
 * в чужой каталог (слэши, `..`, управляющие символы), обрезается здесь, а не
 * в момент создания папки.
 */
export function sanitizeProfileName(name) {
  const safe = String(name).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 80);
  return safe || "default";
}

/**
 * Цели по профилям, в порядке первого появления.
 * @returns {Array<{ profile: string, targets: any[] }>}
 */
export function groupTargetsByProfile(targets) {
  const groups = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    // Служебные блоки (шпаргалки со справочником) — не цели.
    if (!target || typeof target !== "object" || !target.marketplace || !target.cabinetId) continue;
    const profile = profileNameOf(target);
    if (!groups.has(profile)) groups.set(profile, []);
    groups.get(profile).push(target);
  }
  return [...groups.entries()].map(([profile, items]) => ({ profile, targets: items }));
}
