import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('application metadata uses Ledgerly branding', () => {
  const html = read('../index.html');
  assert.match(html, /<title>Ledgerly<\/title>/);
  assert.match(html, /Ledgerly — External Audit Practice Platform/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /connect-src 'self'/);
});

test('Vite emits relative asset paths for file-based desktop loading', () => {
  const vite = read('../vite.config.ts');
  assert.match(vite, /base: '\.\/'/);
  assert.match(vite, /plugins:\s*\[\s*react\(\)\s*\]/);
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
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /permission === 'geolocation'/);
  assert.match(main, /mediaTypes.includes\('video'\) && !mediaTypes.includes\('audio'\)/);
  assert.match(main, /isTrustedPage/);
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
  assert.ok(ci.includes('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'));
  assert.ok(ci.includes('uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'));
  assert.ok(!ci.includes('ubuntu-latest'));
  assert.ok(!ci.includes('actions/checkout@v4'));
  assert.ok(!ci.includes('actions/setup-node@v4'));
  assert.ok(release.includes('runs-on: windows-2025'));
  assert.ok(release.includes('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'));
  assert.ok(release.includes('uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'));
  assert.ok(release.includes('uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9'));
  assert.ok(release.includes('uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131'));
  assert.ok(release.includes('npm ci --no-fund'));
  assert.ok(release.includes('uses: softprops/action-gh-release@efb35369e0ad2afab669f228072c1b0d510eae64'));
});


test('desktop packaging uses a checked-in compatible npm lockfile and npm ci', () => {
  const pkg = JSON.parse(read('../desktop/package.json'));
  const lock = JSON.parse(read('../desktop/package-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].devDependencies.electron, pkg.devDependencies.electron);
  assert.equal(lock.packages[''].devDependencies['electron-builder'], pkg.devDependencies['electron-builder']);
  assert.ok(!JSON.stringify(lock).includes('npmmirror.com'));
  const workflow = read('../.github/workflows/windows-release.yml');
  assert.match(workflow, /working-directory: desktop\\s+run: npm ci --no-fund/);
});

test('vault uses 600000 PBKDF2 iterations and migrates v1 records without rewriting until verification', () => {
  const vault = read('../src/lib/secure-local-vault.ts');
  assert.match(vault, /LEGACY_PBKDF2_ITERATIONS = 310_000/);
  assert.match(vault, /CURRENT_PBKDF2_ITERATIONS = 600_000/);
  assert.match(vault, /recordVersion === 1 \? LEGACY_PBKDF2_ITERATIONS : CURRENT_PBKDF2_ITERATIONS/);
  assert.match(vault, /existing.version === 1/);
  assert.ok(vault.indexOf('const inMemoryUpgrade = await decryptRecord') < vault.indexOf('await storeRecord(upgraded)'));
});
