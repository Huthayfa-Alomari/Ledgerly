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

test('dashboard surfaces actionable audit-priority signals with navigation to each module', () => {
  assert.match(app, /import AuditPriorityPanel from '\.\/components\/AuditPriorityPanel'/);
  for (const key of ['pendingIndependence', 'openRisks', 'reviewQueue', 'unbalancedTB', 'unlinkedEvidence', 'openFindings']) {
    assert.ok(app.includes(key), `dashboard should calculate ${key}`);
  }
  for (const module of ['engagements', 'planning', 'workpapers', 'trial-balance', 'evidence', 'findings']) {
    assert.ok(app.includes(`onOpen:()=>setModule('${module}')`), `priority item should navigate to ${module}`);
  }
});

test('priority panel clearly labels administrative checks and is keyboard/mobile friendly', () => {
  const panel = readFileSync(new URL('../src/components/AuditPriorityPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /aria-labelledby="audit-priority-heading"/);
  assert.match(panel, /administrative indicators, not a conclusion about compliance/i);
  assert.match(panel, /items\.map\(\(item\)/);
  assert.match(css, /\.priority-item:focus-visible/);
  assert.match(css, /\.priority-grid\{grid-template-columns:1fr\}/);
});

test('trial balance analytics engine is integrated into the existing audit module', () => {
  assert.match(app, /import \{ analyzeTrialBalance \} from '\.\/lib\/trial-balance-analytics\.mjs'/);
  assert.match(app, /const tbAnalytics = useMemo\(\(\)=>analyzeTrialBalance\(currentTB/);
  assert.match(app, /تحليلات ميزان المراجعة/);
  assert.match(app, /تصدير نتائج التحليل/);
  assert.match(app, /وثّق استنتاجك في ورقة العمل/);
  assert.match(css, /\.tb-analytics-card/);
});

test('trial balance analytics reports traceable exceptions and documents limitations', () => {
  const engine = readFileSync(new URL('../src/lib/trial-balance-analytics.mjs', import.meta.url), 'utf8');
  assert.match(engine, /unbalanced-/);
  assert.match(engine, /duplicate-account-code/);
  assert.match(engine, /dual-sided-closing-balance/);
  assert.match(engine, /material-closing-balance/);
  assert.match(engine, /does not infer accounting correctness or issue an audit conclusion/);
});

test('completion report includes an evidence-to-workpaper traceability matrix', () => {
  assert.match(app, /const evidenceTraceability = useMemo/);
  assert.match(app, /مصفوفة تتبّع الأدلة/);
  assert.match(app, /مرجع ورقة العمل غير موجود/);
  assert.match(app, /تصدير مصفوفة التتبع/);
  assert.match(app, /لا يثبت كفاية الدليل أو ملاءمته/);
  assert.match(css, /\.traceability-card/);
});

test('planning and completion checklist values are isolated by engagement', () => {
  assert.equal((app.match(/scope={activeEngagement\?\.id\|\|'global'}/g) || []).length, 2);
  assert.equal((app.match(/\[\x60\$\{activeEngagement\?\.id\|\|'global'\}::\$\{item\}\x60\]:checked/g) || []).length, 2);
  assert.match(app, /const key=\x60\$\{scope\}::\$\{s\}\x60/);
  assert.match(app, /scope==='global'\?checked\[s\]:false/);
});

test('AI copilot requires explicit consent and submits only a minimized engagement summary', () => {
  assert.match(app, /import AuditCopilot from '\.\/components\/AuditCopilot'/);
  assert.match(app, /module==='ai-assistant'/);
  assert.match(app, /const aiCopilotContext = useMemo/);
  assert.match(app, /ref:'TB-'/);
  const panel = readFileSync(new URL('../src/components/AuditCopilot.tsx', import.meta.url), 'utf8');
  assert.match(panel, /checked={consent}/);
  assert.match(panel, /if \(!consent\)/);
  assert.match(panel, /ledgerly-ai-assistant/);
  assert.match(panel, /لن تُرسل ملفات الأدلة أو أسماء العملاء/);
  assert.match(panel, /sourceRefs: Array\.isArray/);
  assert.match(css, /\.ai-consent/);
});

test('AI copilot sends aggregate-only context and excludes account-level values', () => {
  assert.doesNotMatch(app, /accounts:summarizeTrialBalanceForCopilot/);
  assert.doesNotMatch(app, /differences:tbAnalytics\.differences/);
  const panel = readFileSync(new URL('../src/components/AuditCopilot.tsx', import.meta.url), 'utf8');
  assert.match(panel, /تُرسل أعدادًا ومؤشرات إجمالية فقط/);
  assert.match(panel, /context\.trialBalance\.issues\.map\(issue => issue\.ref\)/);
  const edge = readFileSync(new URL('../supabase/functions/ledgerly-ai-assistant/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /accounts: \[\]/);
  assert.doesNotMatch(edge, /accountName: typeof q\.accountName/);
  assert.match(edge, /do not infer the cause of a variance/);
});

test('AI edge function applies a database-backed per-user quota and fails closed', () => {
  const edge = readFileSync(new URL('../supabase/functions/ledgerly-ai-assistant/index.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../db/supabase/migrations/202610250001_ai_rate_limit.sql', import.meta.url), 'utf8');
  assert.match(edge, /ledgerly_consume_ai_rate_limit/);
  assert.match(edge, /p_limit: 10, p_window_seconds: 3600/);
  assert.match(edge, /if \(rateError\)/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /grant execute .* to service_role/i);
  assert.match(migration, /request_count <= p_limit/);
});

test('AI edge function is gated, authenticated, server-key only, and does not store requests', () => {
  const edge = readFileSync(new URL('../supabase/functions/ledgerly-ai-assistant/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /LEDGERLY_AI_ENABLED/);
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /app_user/);
  assert.match(edge, /role_assignment/);
  assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(edge, /store: false/);
  assert.match(edge, /Sanitized summary/);
  assert.match(edge, /Never approve workpapers/);
  assert.doesNotMatch(edge, /console\.log\(.*context/i);
});

test('AI edge function allowlists context categories and fixed labels server-side', () => {
  const edge = readFileSync(new URL('../supabase/functions/ledgerly-ai-assistant/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /allowedIssueTitles/);
  assert.match(edge, /Object\.hasOwn\(allowedIssueTitles, candidate\)/);
  assert.match(edge, /title: allowedIssueTitles\[category\]/);
  assert.match(edge, /includes\(String\(x\.engagementType\)\)/);
});


test('member invitation uses exact normalized email lookup and does not return provider errors', () => {
  const invite = readFileSync(new URL('../supabase/functions/ledgerly-invite-member/index.ts', import.meta.url), 'utf8');
  assert.match(invite, /\.eq\("email", email\)/);
  assert.doesNotMatch(invite, /\.ilike\("email", email\)/);
  assert.doesNotMatch(invite, /inviteError\?\.message/);
  assert.doesNotMatch(invite, /error: recordError\.message/);
});

test('invoice matching UI requires unique workpaper links and supports encrypted source archives', () => {
  const panel = readFileSync(new URL('../src/AuditOperationsPanels.tsx', import.meta.url), 'utf8');
  assert.match(panel, /matchInvoiceRegisterToJournal/);
  assert.match(panel, /normalizeInvoiceRegisterRows/);
  assert.match(panel, /resolveUniqueWorkpaper/);
  assert.match(panel, /saveLocalEvidenceFile\(invoiceRegisterSource\.file/);
  assert.match(panel, /حفظ XML الأصلي مشفّرًا/);
  assert.match(panel, /كل نتيجة تحتاج مراجعة بشرية/);
  assert.match(panel, /10,000 صف/);
});


test('mobile 390px layout reduces hero space and keeps the selected nav obvious', () => {
  assert.match(css, /@media\(max-width:400px\)/);
  assert.match(css, /\.welcome-mark\{display:none\}/);
  assert.match(css, /\.audit-sidebar nav button\.active\{background:#244f3c;color:#fff/);
  assert.match(css, /\.audit-table td\{overflow-wrap:anywhere;word-break:normal/);
  assert.match(css, /\.stat-hint\{color:#53635a\}/);
});


test('production CSP has no wildcard Supabase or development endpoints and injects the configured project origin', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.match(csp, /__LEDGERLY_CONNECT_SOURCES__/);
  assert.doesNotMatch(csp, /https:\/\/\*\.supabase\.co|127\.0\.0\.1:5173|cdn\.jsdelivr\.net/);
  assert.match(vite, /loadEnv\(mode, process\.cwd\(\), 'VITE_'\)/);
  assert.match(vite, /endpoint\.origin/);
  assert.match(vite, /html\.replace\('__LEDGERLY_CONNECT_SOURCES__'/);
});

test('amount separator convention belongs to each imported file and preserves the other source', () => {
  const reconciliation = readFileSync(new URL('../src/Reconciliation.tsx', import.meta.url), 'utf8');
  assert.match(reconciliation, /type ImportedFile = \{[^}]*commaMode: 'strict' \| 'thousands' \| 'decimal'/);
  assert.match(reconciliation, /commaMode: 'strict', note/);
  assert.match(reconciliation, /if \(assignedRole === 'bank'\) setBankData\(normalizeRows\(file\.rows, file\.mapping, \{ commaMode: nextMode \}\)\)/);
  assert.match(reconciliation, /if \(assignedRole === 'ledger'\) setLedgerData\(normalizeRows\(file\.rows, file\.mapping, \{ commaMode: nextMode \}\)\)/);
});

test('OCR worker and core are imported as local build assets instead of a CDN worker script', () => {
  const reconciliation = readFileSync(new URL('../src/Reconciliation.tsx', import.meta.url), 'utf8');
  assert.match(reconciliation, /tesseract\.js\/dist\/worker\.min\.js\?url/);
  assert.match(reconciliation, /tesseract\.js-core\/tesseract-core\.wasm\.js\?url/);
  assert.match(reconciliation, /workerPath: tesseractWorkerUrl, corePath: tesseractCoreUrl/);
});


test('OCR Arabic and English trained data are downloaded during production build and loaded locally', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const prepare = readFileSync(new URL('../scripts/prepare-ocr-data.mjs', import.meta.url), 'utf8');
  const reconciliation = readFileSync(new URL('../src/Reconciliation.tsx', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(packageJson.scripts.prebuild, 'npm run prepare:ocr');
  assert.match(prepare, /\['ara', 'eng'\]/);
  assert.match(prepare, /tessdata\.projectnaptha\.com\/4\.0\.0/);
  assert.match(prepare, /bytes\[0\] !== 0x1f \|\| bytes\[1\] !== 0x8b/);
  assert.match(reconciliation, /langPath: new URL\(/);
  assert.doesNotMatch(html, /tessdata\.projectnaptha\.com/);
});


test('packaged Electron app serves local assets through a restricted secure protocol', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /registerSchemesAsPrivileged/);
  assert.match(main, /supportFetchAPI: true/);
  assert.match(main, /protocol\.handle\('ledgerly', handlePackagedAsset\)/);
  assert.match(main, /path\.relative\(packagedRoot, target\)/);
  assert.match(main, /url\.hostname !== 'app'/);
  assert.match(main, /loadURL\('ledgerly:\/\/app\/index\.html'\)/);
  assert.doesNotMatch(main, /nodeIntegration: true|webSecurity: false/);
});
