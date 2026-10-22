import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('local workspace waits for encrypted-vault unlock before persisting data', () => {
  assert.match(app, /const loaded=loadLocalData\(\(\)=>localStorage,KEY,emptyDB\)/);
  assert.match(app, /if\(loaded\.error==='invalid-json'\)/);
  assert.match(app, /useState\(false\)/);
  assert.match(app, /مخزن Ledgerly المحلي المشفّر/);
  assert.match(app, /unlockOrInitializeLocalVault/);
  assert.match(app, /if\(!storagePersistenceEnabled\|\|!vaultUnlocked\)return/);
  assert.match(app, /persistEncryptedLocalVault\(vaultPassphrase,db\)/);
});

test('recovery UI offers a raw export before reinitializing unreadable legacy data', () => {
  assert.match(app, /ledgerly-legacy-recovery-plaintext\.json/);
  
  
  assert.match(app, /setStorageLoadError\(''\);setStoragePersistenceEnabled\(true\)/);
  assert.match(app, /disabled=\{!vaultRawBackupDownloaded\}/);
});

test('backup restore validates JSON collections and only then re-enables persistence', () => {
  assert.match(app, /!keys\.every\(k=>Array\.isArray\(parsed\[k\]\)\)/);
  assert.match(app, /setStorageLoadError\(''\);setStoragePersistenceEnabled\(true\)/);
  assert.match(app, /restoreBackup\(e\.target\.files\?\.\[0\]\)/);
});
