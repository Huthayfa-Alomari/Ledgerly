import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('local save failure exposes recovery export and an explicit retry', () => {
  assert.match(app, /تعذّر حفظ البيانات محليًا/);
  assert.match(app, /downloadRecoverySnapshot\(db\)/);
  assert.match(app, /ledgerly-recovery-current\.json/);
  assert.match(app, /إعادة محاولة الحفظ/);
  assert.match(app, /persistLocalData\(\(\)=>localStorage,KEY,db\)/);
});

test('settings distinguish cloud-enabled features from local-mode and release-gate limitations', () => {
  assert.match(app, /حدود النسخة الحالية قبل الإنتاج/);
  assert.match(app, /LocalStorage غير مشفّرة/);
  assert.match(app, /دعوات أعضاء المكاتب يجب أن تبقى معطّلة/);
  assert.match(app, /فحص البرمجيات الخبيثة/);
  assert.doesNotMatch(app, /ميزات تتطلب ربطًا قبل الإنتاج/);
});
