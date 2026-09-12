"use client";

import { Check } from "lucide-react";
import { EXTERNAL_ROLES, ROLE_LABEL, isExternalRole, type Role } from "@/lib/auth/permissions";

/**
 * Выбор ролей сотрудника.
 *
 * Роль тут не одна. В базе роли лежат списком, а движок прав складывает их:
 * действие разрешено, если его разрешает хотя бы одна. Выпадающий список,
 * стоявший здесь раньше, физически не давал выдать вторую роль — закупщик,
 * который вечером считает юнит-экономику, оформлялся как «или то, или это».
 *
 * Внутренние и внешние роли разведены в две группы и не смешиваются: это
 * граница между нашей компанией и компанией клиента, а не удобный набор прав.
 * Выбор внешней роли гасит внутренние и наоборот — запрет виден руками, а не
 * только отказом сервера после сохранения.
 */

const INTERNAL: Role[] = (Object.keys(ROLE_LABEL) as Role[]).filter((role) => !isExternalRole(role));
const EXTERNAL: Role[] = [...EXTERNAL_ROLES];

function Group({
  title,
  hint,
  roles,
  value,
  disabled,
  onToggle,
}: {
  title: string;
  hint: string;
  roles: Role[];
  value: Role[];
  disabled: boolean;
  onToggle: (role: Role) => void;
}) {
  return (
    <div className={disabled ? "opacity-40" : ""}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-400">{title}</span>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roles.map((role) => {
          const on = value.includes(role);
          return (
            <button
              key={role}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onToggle(role)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                on
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {on ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
              {ROLE_LABEL[role]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RoleSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  disabled?: boolean;
}) {
  const external = value.some(isExternalRole);
  const internal = value.some((role) => !isExternalRole(role));

  const toggle = (role: Role) => {
    if (value.includes(role)) {
      const next = value.filter((item) => item !== role);
      // Без единой роли человек не сможет войти никуда. Снятие последней
      // отметки — это «отключить», и делается оно отдельной кнопкой.
      if (next.length) onChange(next);
      return;
    }
    // Переход через границу контуров заменяет набор, а не дополняет его.
    const crossing = isExternalRole(role) ? internal : external;
    onChange(crossing ? [role] : [...value, role]);
  };

  return (
    <div className="space-y-3">
      <Group
        title="Наша компания"
        hint="права складываются"
        roles={INTERNAL}
        value={value}
        disabled={disabled || external}
        onToggle={toggle}
      />
      <Group
        title="Внешний клиент"
        hint="отдельный контур, с внутренними не совмещается"
        roles={EXTERNAL}
        value={value}
        disabled={disabled || internal}
        onToggle={toggle}
      />
    </div>
  );
}
