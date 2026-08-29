/**
 * Выгрузка таблицы кокпита в CSV.
 *
 * Менеджеру регулярно нужно унести срез наружу: отправить поставщику, свести
 * с ручной таблицей, показать руководителю. Пока кнопки не было, это делалось
 * выделением мышью — с потерей чисел и колонок.
 *
 * Excel по-русски читает CSV только с точкой с запятой в качестве разделителя
 * и BOM в начале файла, иначе получается одна колонка и «Ð¿Ñ€Ð¸Ð²ÐµÑ‚» вместо
 * кириллицы. Дробные числа тоже пишем по-русски — с запятой.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const cell = (value: string | number | null | undefined): string => {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value * 100) / 100).replace(".", ",");
  }
  const text = String(value);
  // Точка с запятой, кавычки и переносы строк ломают строку — экранируем.
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((column) => cell(column.header)).join(";")];
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Имя файла с кабинетом и периодом — чтобы выгрузки не путались между собой. */
export function csvFileName(parts: Array<string | undefined | null>): string {
  const clean = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-"));
  return `${clean.join("_") || "ozon"}.csv`;
}

export function downloadCsv<T>(fileName: string, columns: CsvColumn<T>[], rows: T[]): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([buildCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Освобождаем адрес не сразу: Safari успевает начать скачивание только
  // после того, как клик отработал.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
