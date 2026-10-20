import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('application metadata uses Ledgerly branding', () => {
  const html = read('../index.html');
  assert.match(html, /<title>Ledgerly<\/title>/);
  assert.match(html, /Ledgerly — External Audit Practice Platform/);
});

test('Windows package creates a named NSIS installer without deleting local data on uninstall', () => {
  const pkg = JSON.parse(read('../desktop/package.json'));
  assert.equal(pkg.build.productName, 'Ledgerly');
  assert.equal(pkg.build.appId, 'com.ledgerly.audit');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
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
