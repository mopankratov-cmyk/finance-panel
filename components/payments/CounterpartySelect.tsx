"use client";

import { useId, useRef, useState } from "react";

/** Native chooser works with a mouse, keyboard and touch; new names are committed once. */
export function CounterpartySelect({ value, options, onChange, label = "Контрагент", ariaLabel = label, compact = false, disabled = false }: {
  value: string; options: readonly string[]; onChange: (value: string) => void; label?: string; ariaLabel?: string; compact?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const names = [...new Set([...options, value].map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  const field = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:bg-slate-100";
  const commit = () => {
    if (cancelled.current) return;
    const name = draft.trim();
    setEditing(false);
    if (name !== value) onChange(name);
  };
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className={compact ? "block text-xs text-slate-500 md:sr-only" : "block text-xs text-slate-500"}>{label}</label>
    <select id={id} aria-label={ariaLabel} value={value.trim()} disabled={disabled} className={field} onChange={e => {
      if (e.target.value === "__new_counterparty__") { cancelled.current = false; setDraft(""); setEditing(true); }
      else { setEditing(false); onChange(e.target.value); }
    }}>
      <option value="">Не выбран</option>
      {names.map(name => <option key={name} value={name}>{name}</option>)}
      <option value="__new_counterparty__">+ Вписать нового…</option>
    </select>
    {editing && <div className="space-y-1"><input autoFocus aria-label={`${ariaLabel}: новый`} maxLength={500} value={draft} disabled={disabled} placeholder="Имя или название" className={field} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelled.current = true; setEditing(false); }
    }}/><p className="text-xs text-slate-500">Enter — сохранить имя, Escape — отменить.</p></div>}
  </div>;
}
