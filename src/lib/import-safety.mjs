export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_WORKSHEET_ROWS = 250_000;
export const MAX_WORKSHEET_COLUMNS = 256;
export const MAX_WORKSHEET_CELLS = 2_000_000;
export const MAX_PDF_PAGES = 500;
export const MAX_OCR_PAGES = 100;
export const MAX_OCR_PIXELS_PER_PAGE = 16_000_000;
export const MAX_OCR_TOTAL_PIXELS = 100_000_000;

export function fileSizeIssue(size, maxBytes = MAX_IMPORT_FILE_BYTES) {
  if (!Number.isFinite(size) || size < 0) return 'invalid-file-size';
  return size > maxBytes ? 'file-too-large' : null;
}

/** Check dimensions before materializing a worksheet as a large array of row arrays. */
export function worksheetDimensionIssue(rowCount, columnCount) {
  if (!Number.isSafeInteger(rowCount) || !Number.isSafeInteger(columnCount)
    || rowCount < 0 || columnCount < 0) return 'invalid-worksheet-dimensions';
  if (rowCount > MAX_WORKSHEET_ROWS + 1) return 'too-many-rows';
  if (columnCount > MAX_WORKSHEET_COLUMNS) return 'too-many-columns';
  if (rowCount * columnCount > MAX_WORKSHEET_CELLS) return 'too-many-cells';
  return null;
}

/** Fallback validation for CSV/parsers that do not expose a declared worksheet range. */
export function matrixDimensionIssue(matrix) {
  if (!Array.isArray(matrix)) return 'invalid-worksheet-dimensions';
  let columns = 0;
  for (const row of matrix) {
    if (!Array.isArray(row)) return 'invalid-worksheet-dimensions';
    columns = Math.max(columns, row.length);
    if (row.length > MAX_WORKSHEET_COLUMNS) return 'too-many-columns';
  }
  return worksheetDimensionIssue(matrix.length, columns);
}

export function pdfPageIssue(pageCount) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 0) return 'invalid-pdf-page-count';
  return pageCount > MAX_PDF_PAGES ? 'too-many-pdf-pages' : null;
}

export function ocrPageIssue(pageCount) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 0) return 'invalid-pdf-page-count';
  return pageCount > MAX_OCR_PAGES ? 'too-many-ocr-pages' : null;
}

export function ocrPixelIssue(width, height, previousTotal = 0) {
  if (![width, height, previousTotal].every(Number.isFinite)
    || width <= 0 || height <= 0 || previousTotal < 0) return 'invalid-ocr-dimensions';
  const pixels = Math.ceil(width) * Math.ceil(height);
  if (!Number.isSafeInteger(pixels) || pixels > MAX_OCR_PIXELS_PER_PAGE) return 'ocr-page-too-large';
  if (previousTotal + pixels > MAX_OCR_TOTAL_PIXELS) return 'ocr-work-too-large';
  return null;
}
