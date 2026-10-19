import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');

test('workpaper creation captures procedure, conclusion and tickmarks', () => {
  assert.match(app, /procedure:form\.procedure\|\|''/);
  assert.match(app, /conclusion:form\.conclusion\|\|''/);
  assert.match(app, /tickmarks:form\.tickmarks\|\|''/);
});

test('workpaper state transitions append a version history event and activity record', () => {
  assert.match(app, /history=\[\.\.\.\(x\.history\|\|\[\]\),\{version:\(x\.version\|\|1\)\+1/);
  assert.match(app, /action:'تحديث حالة ورقة عمل'/);
  assert.match(app, /version:\(x\.version\|\|1\)\+1/);
});

test('UI discloses the history is local and not tamper-proof', () => {
  assert.match(app, /السجل المحلي ليس سجلًا غير قابل للتلاعب/);
  assert.match(css, /\.history-details/);
});

test('review notes are versioned and recorded in the local activity log', () => {
  assert.match(app, /تسجيل ملاحظة مراجعة/);
  assert.match(app, /action:'تحديث ملاحظة مراجعة'/);
  assert.match(app, /reviewNotes:note/);
});
