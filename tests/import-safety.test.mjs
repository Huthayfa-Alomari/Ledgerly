import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_FILE_BYTES, MAX_WORKSHEET_ROWS, MAX_WORKSHEET_COLUMNS,
  MAX_PDF_PAGES, MAX_PDF_TEXT_ITEMS_PER_PAGE, MAX_PDF_TEXT_ITEMS_TOTAL, MAX_OCR_PAGES,
  fileSizeIssue, worksheetDimensionIssue, matrixDimensionIssue, pdfPageIssue, pdfTextItemIssue, ocrPageIssue, ocrPixelIssue,
} from '../src/lib/import-safety.mjs';

test('enforces uploaded file size and accepts the exact boundary', () => {
  assert.equal(fileSizeIssue(MAX_IMPORT_FILE_BYTES), null);
  assert.equal(fileSizeIssue(MAX_IMPORT_FILE_BYTES + 1), 'file-too-large');
  assert.equal(fileSizeIssue(-1), 'invalid-file-size');
});

test('bounds worksheet row, column and total-cell dimensions before JSON expansion', () => {
  assert.equal(worksheetDimensionIssue(MAX_WORKSHEET_ROWS + 1, 7), null); // one header + max data rows
  assert.equal(worksheetDimensionIssue(MAX_WORKSHEET_ROWS + 2, 7), 'too-many-rows');
  assert.equal(worksheetDimensionIssue(10, MAX_WORKSHEET_COLUMNS + 1), 'too-many-columns');
  assert.equal(worksheetDimensionIssue(100_000, 21), 'too-many-cells');
  assert.equal(worksheetDimensionIssue(100_000, 20), null);
  assert.equal(matrixDimensionIssue([['a', 'b'], [1, 2]]), null);
  assert.equal(matrixDimensionIssue([Array(MAX_WORKSHEET_COLUMNS + 1).fill('x')]), 'too-many-columns');
});

test('limits PDF pages and total OCR pixels before allocating a canvas', () => {
  assert.equal(pdfPageIssue(MAX_PDF_PAGES), null);
  assert.equal(pdfPageIssue(MAX_PDF_PAGES + 1), 'too-many-pdf-pages');
  assert.equal(ocrPageIssue(MAX_OCR_PAGES), null);
  assert.equal(ocrPageIssue(MAX_OCR_PAGES + 1), 'too-many-ocr-pages');
  assert.equal(ocrPixelIssue(4000, 4000), null);
  assert.equal(ocrPixelIssue(5000, 4000), 'ocr-page-too-large');
  assert.equal(ocrPixelIssue(10_000_000, 1, MAX_OCR_TOTAL_PIXELS - 1), 'ocr-work-too-large');
});

test('limits pathological PDF text-item counts per page and across the document', () => {
  assert.equal(pdfTextItemIssue(MAX_PDF_TEXT_ITEMS_PER_PAGE), null);
  assert.equal(pdfTextItemIssue(MAX_PDF_TEXT_ITEMS_PER_PAGE + 1), 'too-many-pdf-text-items');
  assert.equal(pdfTextItemIssue(1, MAX_PDF_TEXT_ITEMS_TOTAL), 'too-many-pdf-text-items-total');
  assert.equal(pdfTextItemIssue(-1), 'invalid-pdf-text-count');
});
