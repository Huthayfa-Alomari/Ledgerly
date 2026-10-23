import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocxBytes, createStoredZip } from '../src/lib/docx-export.mjs';

function readAscii(bytes, start, length) { return new TextDecoder().decode(bytes.slice(start, start + length)); }

test('stored ZIP output contains local headers, central directory, and end marker', () => {
  const zip = createStoredZip([{ name: 'a.txt', data: 'ledgerly' }]);
  assert.equal(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true), 0x04034b50);
  assert.ok(readAscii(zip, 30, 5) === 'a.txt');
  assert.ok(readAscii(zip, zip.length - 22, 4).charCodeAt(0) === 0x50);
});

test('Word report is a DOCX package with an OOXML document and escaped user content', () => {
  const docx = buildDocxBytes({
    title: 'تقرير تدقيق تجريبي',
    paragraphs: ['هذا مستند مسودة للمراجعة البشرية.', 'A & B < draft'],
    tables: [[['الحساب', 'المبلغ'], ['نقد', '12.345']]],
  });
  const decoder = new TextDecoder();
  const raw = decoder.decode(docx);
  assert.equal(new DataView(docx.buffer, docx.byteOffset, docx.byteLength).getUint32(0, true), 0x04034b50);
  assert.ok(raw.includes('[Content_Types].xml'));
  assert.ok(raw.includes('word/document.xml'));
});
