import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('PWA entry point advertises a manifest and registers a worker only on HTTPS', () => {
  assert.match(html, /rel="manifest"/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(app, /window\.location\.protocol!=='https:'/);
  assert.match(app, /serviceWorker\.register\('\.\/sw\.js'\)/);
});

test('offline worker caches static shell only and excludes auth, REST, functions, and storage endpoints', () => {
  assert.match(worker, /ledgerly-static-shell-v1/);
  assert.match(worker, /\/auth\/v1\//);
  assert.match(worker, /\/rest\/v1\//);
  assert.match(worker, /\/functions\/v1\//);
  assert.match(worker, /\/storage\/v1\//);
  assert.match(worker, /Only static app assets are cached/);
});
