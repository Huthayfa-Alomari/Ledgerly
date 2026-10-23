import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/windows-release.yml', import.meta.url), 'utf8');

test('Windows installer workflow supports certificate-backed Authenticode signing', () => {
  assert.match(workflow, /WIN_CSC_LINK:\s*\$\{\{ secrets\.WIN_CSC_LINK \}\}/);
  assert.match(workflow, /WIN_CSC_KEY_PASSWORD:\s*\$\{\{ secrets\.WIN_CSC_KEY_PASSWORD \}\}/);
  assert.match(workflow, /forceCodeSigning=true/);
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /signature\.Status -ne "Valid"/);
});

test('Windows installer workflow creates a SHA-256 manifest without treating it as malware proof', () => {
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /does not establish safety or publisher identity/);
  assert.match(workflow, /desktop\/release\/\*\.exe/);
});
