/**
 * CSV utilities for client-side exports.
 * Поддерживает:
 * - экранирование кавычек
 * - оборачивание значений в кавычки при наличии спецсимволов
 * - переносы строк
 */

export type CsvRow = Array<string | number | boolean | null | undefined>;

/**
 * Экранирует одно CSV-значение по правилам RFC 4180 (практически).
 * - если значение содержит запятую, кавычку или перенос строки → оборачиваем в двойные кавычки
 * - двойные кавычки внутри значения удваиваем
 */
export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  const needsQuotes = /[",\r\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * Собирает CSV-текст из заголовков и строк.
 */
export function toCsv(headers: CsvRow, rows: CsvRow[]): string {
  const headerLine = headers.map(csvEscape).join(",");
  const bodyLines = rows.map((r) => r.map(csvEscape).join(","));
  return [headerLine, ...bodyLines].join("\n");
}

/**
 * Скачивает текст как файл в браузере.
 * Делает cleanup URL и временного <a/>.
 */
export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Утилита one-liner для CSV экспорта.
 */
export function downloadCsvFile(filename: string, headers: CsvRow, rows: CsvRow[]) {
  const csv = toCsv(headers, rows);
  downloadTextFile(filename, csv, "text/csv;charset=utf-8");
}
