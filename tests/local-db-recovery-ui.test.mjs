import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('invalid local JSON blocks persistence during initial load', () => {
  assert.match(app, /const loaded=loadLocalData\(\(\)=>localStorage,KEY,emptyDB\)/);
  assert.match(app, /if\(loaded\.error==='invalid-json'\)/);
  assert.match(app, /useState\(!initialData\.error\)/);
  assert.match(app, /useEffect\(\(\)=>\{ if\(!storagePersistenceEnabled\)return;/);
});

test('recovery UI offers a raw export and requires it before local reinitialization', () => {
  assert.match(app, /function downloadUnreadableLocalData\(\)/);
  assert.match(app, /ledgerly-local-recovery\.txt/);
  assert.match(app, /if\(!rawBackupDownloaded\)/);
  assert.match(app, /setStorageLoadError\(''\);setStoragePersistenceEnabled\(true\)/);
  assert.match(app, /aria-modal="true" aria-labelledby="ledgerly-recovery-title"/);
});

test('backup restore validates JSON collections and only then re-enables persistence', () => {
  assert.match(app, /!keys\.every\(k=>Array\.isArray\(parsed\[k\]\)\)/);
  assert.match(app, /setStorageLoadError\(''\);setStoragePersistenceEnabled\(true\)/);
  assert.match(app, /restoreBackup\(e\.target\.files\?\.\[0\]\)/);
});
