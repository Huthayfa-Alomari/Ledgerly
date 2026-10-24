/**
 * CSV cell encoder shared by every Ledgerly export.
 * Quotes all cells, doubles embedded quotes, flattens line breaks, and neutralizes
 * spreadsheet formulas without coercing ordinary negative numeric amounts to text.
 */
export function csvCell(value) {
  let cell = String(value ?? '').replace(/\r\n?|\n/g, ' ');
  const trimmed = cell.trim();
  const isPlainNumber = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed);
  if (!isPlainNumber && /^[\s]*[=+\-@]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
}

export function csvRow(values) {
  return values.map(csvCell).join(',');
}
