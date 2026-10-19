import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('dashboard offers demo records without replacing existing user data', () => {
  assert.match(app, /function loadDemoData\(\)/);
  assert.match(app, /db\.clients\.some\(c=>c\.taxNumber==='DEMO-1001'\)/);
  assert.match(app, /clients:\[\.\.\.p\.clients,client\]/);
  assert.match(app, /إضافة عميل وملف تدقيق وسجلات وهمية دون حذف بياناتك الحالية/);
  assert.match(app, /تحميل بيانات تجريبية/);
  assert.match(app, /لا تمثل عميلًا أو تدقيقًا حقيقيًا/);
});

test('loading demo data appends to existing data instead of replacing it', () => {
  assert.match(app, /setDB\(p=>\(\{\.\.\.p,clients:\[\.\.\.p\.clients,client\]/);
  assert.match(app, /trialBalance:\[\.\.\.p\.trialBalance,\.\.\.trialBalance\]/);
});

test('demo engagement includes linked workpaper, risk, evidence, finding, and trial balance rows', () => {
  for (const token of ['const engagement:Engagement', 'const risk:Risk', 'const workpaper:Workpaper', 'const finding:Finding', 'const evidence:Evidence', 'const trialBalance:TBRow[]']) {
    assert.ok(app.includes(token), `demo data should include ${token}`);
  }
  assert.match(app, /setSelectedEngagement\(engagementId\)/);
});

test('UI refresh supports mobile navigation and reduced-motion preferences', () => {
  assert.match(css, /@media\(max-width:720px\)\{\s*\.audit-shell\{display:block\}/);
  assert.match(css, /\.audit-sidebar nav\{display:flex;gap:5px;overflow-x:auto/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /button:focus-visible/);
});
