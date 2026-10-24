import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const intelligence = readFileSync(new URL('../src/AuditIntelligence.tsx', import.meta.url), 'utf8');

test('local save failure exposes recovery export and an explicit retry', () => {
  assert.match(app, /تعذّر حفظ البيانات محليًا/);
  assert.match(app, /downloadRecoverySnapshot\(db\)/);
  assert.match(app, /ledgerly-recovery-current\.json/);
  assert.match(app, /إعادة محاولة الحفظ/);
  assert.match(app, /persistEncryptedLocalVault\(vaultPassphrase,db\)/);
  assert.match(app, /AES-GCM بمفتاح 256 بت/);
  assert.match(app, /vault-critical-warning/);
  assert.match(app, /إظهار كلمة المرور/);
});

test('settings distinguish cloud-enabled features from local-mode and release-gate limitations', () => {
  assert.match(app, /حدود النسخة الحالية قبل الإنتاج/);
  assert.match(app, /مساحة العمل في IndexedDB بعد تشفير AES-GCM/);
  assert.doesNotMatch(app, /! بيانات LocalStorage غير مشفّرة على مستوى التطبيق/);
  assert.match(app, /دعوات أعضاء المكاتب يجب أن تبقى معطّلة/);
  assert.match(app, /فحص البرمجيات الخبيثة/);
  assert.doesNotMatch(app, /ميزات تتطلب ربطًا قبل الإنتاج/);
});


test('public-beta wording is professional while retaining clear local-storage and client-data limits', () => {
  assert.match(app, /مساحة عمل محلية/);
  assert.match(app, /المزامنة السحابية غير مفعّلة/);
  assert.doesNotMatch(app, /وضع محلي تجريبي/);
  assert.match(intelligence, /للتجربة الحالية، استخدم بيانات اصطناعية فقط/);
  assert.match(intelligence, /لا تستخدم بيانات عملاء حقيقية قبل إغلاق متطلبات الأمن/);
  assert.doesNotMatch(intelligence, /حالة التطوير: مركز محلي أولي قابل للاختبار/);
});
