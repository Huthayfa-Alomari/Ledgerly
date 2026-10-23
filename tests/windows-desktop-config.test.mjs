import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('application metadata uses Ledgerly branding', () => {
  const html = read('../index.html');
  assert.match(html, /<title>Ledgerly<\/title>/);
  assert.match(html, /Ledgerly — External Audit Practice Platform/);
});

test('Vite emits relative asset paths for file-based desktop loading', () => {
  const vite = read('../vite.config.ts');
  assert.match(vite, /base: '\.\/'/);
});

test('Windows package creates a named NSIS installer without deleting local data on uninstall', () => {
  const pkg = JSON.parse(read('../desktop/package.json'));
  assert.equal(pkg.build.productName, 'Ledgerly');
  assert.equal(pkg.build.appId, 'com.ledgerly.audit');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.devDependencies.electron, '44.9.2');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.win.target[0].target, 'nsis');
});

test('Electron window disables Node integration and enables context isolation and sandbox', () => {
  const main = read('../desktop/main.cjs');
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /setWindowOpenHandler/);
});

test('version tags publish the built installer as a permanent GitHub Release asset', () => {
  const workflow = read('../.github/workflows/windows-release.yml');
  assert.match(workflow, /tags:\s*\n\s*- "ledgerly-v\*"/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/ledgerly-v'\)/);
  assert.match(workflow, /uses: softprops\/action-gh-release@v3/);
  assert.match(workflow, /files: desktop\/release\/\*\.exe/);
});

test('Windows release uses explicit public cloud variables and fails on high-severity dependency issues', () => {
  const workflow = read('../.github/workflows/windows-release.yml');
  assert.match(workflow, /VITE_SUPABASE_URL: \$\{\{ vars\.VITE_SUPABASE_URL \}\}/);
  assert.match(workflow, /VITE_SUPABASE_ANON_KEY: \$\{\{ vars\.VITE_SUPABASE_ANON_KEY \}\}/);
  assert.match(workflow, /npm audit --audit-level=high/);
});


test('GitHub Actions use Node 24-compatible action majors and pinned runner images', () => {
  const ci = read('../.github/workflows/ci.yml');
  const release = read('../.github/workflows/windows-release.yml');
  assert.ok(ci.includes('runs-on: ubuntu-24.04'));
  assert.ok(ci.includes('uses: actions/checkout@v7'));
  assert.ok(ci.includes('uses: actions/setup-node@v7'));
  assert.ok(!ci.includes('ubuntu-latest'));
  assert.ok(!ci.includes('actions/checkout@v4'));
  assert.ok(!ci.includes('actions/setup-node@v4'));
  assert.ok(release.includes('runs-on: windows-2025'));
  assert.ok(release.includes('uses: actions/checkout@v7'));
  assert.ok(release.includes('uses: actions/setup-node@v7'));
  assert.ok(release.includes('uses: actions/upload-artifact@v7'));
  assert.ok(release.includes('uses: softprops/action-gh-release@v3'));
});
