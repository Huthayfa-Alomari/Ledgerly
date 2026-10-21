export const MAX_IMPORT_FILE_BYTES: number;
export const MAX_WORKSHEET_ROWS: number;
export const MAX_WORKSHEET_COLUMNS: number;
export const MAX_WORKSHEET_CELLS: number;
export const MAX_PDF_PAGES: number;
export const MAX_OCR_PAGES: number;
export const MAX_OCR_PIXELS_PER_PAGE: number;
export const MAX_OCR_TOTAL_PIXELS: number;
export type ImportLimitIssue =
  | 'invalid-file-size' | 'file-too-large'
  | 'invalid-worksheet-dimensions' | 'too-many-rows' | 'too-many-columns' | 'too-many-cells'
  | 'invalid-pdf-page-count' | 'too-many-pdf-pages' | 'too-many-ocr-pages'
  | 'invalid-ocr-dimensions' | 'ocr-page-too-large' | 'ocr-work-too-large';
export function fileSizeIssue(size: number, maxBytes?: number): ImportLimitIssue | null;
export function worksheetDimensionIssue(rowCount: number, columnCount: number): ImportLimitIssue | null;
export function matrixDimensionIssue(matrix: unknown): ImportLimitIssue | null;
export function pdfPageIssue(pageCount: number): ImportLimitIssue | null;
export function ocrPageIssue(pageCount: number): ImportLimitIssue | null;
export function ocrPixelIssue(width: number, height: number, previousTotal?: number): ImportLimitIssue | null;
