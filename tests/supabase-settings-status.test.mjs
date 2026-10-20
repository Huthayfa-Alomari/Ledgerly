import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('settings clearly distinguishes Supabase configuration from active cloud sync', () => {
  assert.match(app, /حالة الاتصال السحابي/);
  assert.match(app, /تسجيل الدخول السحابي متاح اختياريًا؛ مزامنة بيانات التدقيق غير مفعّلة بعد/);
  assert.match(app, /لم تُربط بعد — البيانات ما زالت محلية/);
  assert.match(app, /readSupabaseBrowserConfig\(\{ VITE_SUPABASE_URL: import\.meta\.env\.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: import\.meta\.env\.VITE_SUPABASE_ANON_KEY \}\)/);
});
