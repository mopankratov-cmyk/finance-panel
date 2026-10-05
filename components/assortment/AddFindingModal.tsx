"use client";

import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DIRECTION_LABEL, type AssortmentDirection } from "@/lib/assortment/constants";
import { PHOTO_ACCEPT, pickPhotos, uploadPhoto } from "./uploadPhoto";

interface ImportResponse {
  referenceId?: string;
  created?: boolean;
  title?: string;
  images?: number;
  warnings?: string[];
  error?: string;
}

export function AddFindingModal({
  open,
  direction,
  onClose,
  onImported,
}: {
  open: boolean;
  direction: AssortmentDirection;
  onClose: () => void;
  onImported: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const reset = () => {
    setUrl("");
    setTitle("");
    setNote("");
    setFiles([]);
    setError(null);
    setResult(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const pickFiles = (list: FileList | null) => {
    const picked = pickPhotos(files, list);
    setFiles(picked.files);
    setError(picked.rejected.length > 0 ? picked.rejected.join("; ") : null);
  };

  const submit = async () => {
    if (!url.trim() && files.length === 0) {
      setError("Вставьте ссылку или приложите хотя бы одно фото.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploads: string[] = [];
      for (const file of files) uploads.push(await uploadPhoto(file));
      const response = await fetch("/api/assortment-development/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction, url: url.trim() || null, title: title.trim() || null, note: note.trim() || null, uploads }),
      });
      const body = (await response.json().catch(() => ({}))) as ImportResponse;
      if (!response.ok) throw new Error(body.error ?? `Не удалось добавить находку (${response.status})`);
      setResult(body);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить находку");
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={reset} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50">Добавить ещё</button>
      <button type="button" onClick={close} className="h-11 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800">Готово</button>
    </div>
  ) : (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={close} disabled={busy} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60">Отмена</button>
      <button type="button" onClick={submit} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60">
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {busy ? "Добавляем…" : "Добавить"}
      </button>
    </div>
  );

  return (
    <Modal open={open} onClose={close} title={`Добавить находку · ${DIRECTION_LABEL[direction]}`} footer={footer} size="md">
      {result ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            {result.created ? "Добавлено в ленту" : "Уже было в ленте"}: <b>{result.title}</b>
            {typeof result.images === "number" && ` · фото: ${result.images}`}
          </div>
          {(result.warnings ?? []).map((warning) => (
            <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-slate-600">
            Ссылка на товар, публикацию или пин
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-slate-600">Фото или скриншот (до 6, JPEG/PNG/WebP, до 10 МБ)</span>
            <label className="flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:bg-slate-50">
              <ImagePlus className="h-6 w-6 shrink-0 text-slate-400" />
              <span>Выбрать файлы</span>
              <input type="file" accept={PHOTO_ACCEPT.join(",")} multiple className="sr-only" onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-3 pr-1 text-xs text-slate-700">
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    <button type="button" aria-label={`Убрать ${file.name}`} onClick={() => setFiles(files.filter((_, i) => i !== index))} className="grid h-10 w-10 place-items-center rounded-md hover:bg-slate-200">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-sm text-slate-600">
            Название (если сайт его не отдаст)
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-slate-600">
            Заметка
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Что зацепило в модели" className="rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
          </label>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
