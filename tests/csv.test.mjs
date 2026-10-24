import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow } from '../src/lib/csv.mjs';
import { readFileSync } from 'node:fs';

test('CSV cells quote correctly and escape embedded double quotes', () => {
  assert.equal(csvCell('hello, "world"'), '"hello, ""world"""');
  assert.equal(csvCell('line 1\nline 2'), '"line 1 line 2"');
});

test('CSV cells neutralize spreadsheet formula payloads', () => {
  assert.equal(csvCell('=HYPERLINK("https://evil.example","click")'), '"\'=HYPERLINK(""https://evil.example"",""click"")"');
  assert.equal(csvCell('  @SUM(A1:A2)'), '"\'  @SUM(A1:A2)"');
  assert.equal(csvCell('-1+1'), '"\'-1+1"');
});

test('CSV cells preserve negative numeric values and zero as numbers', () => {
  assert.equal(csvCell('-123.450'), '"-123.450"');
  assert.equal(csvCell('0'), '"0"');
  assert.equal(csvRow(['=1+1', -2, 'A,B']), '"\'=1+1","-2","A,B"');
});


test('all audit CSV entry points delegate to the shared safe encoder', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const intel = readFileSync(new URL('../src/AuditIntelligence.tsx', import.meta.url), 'utf8');
  const operations = readFileSync(new URL('../src/AuditOperationsPanels.tsx', import.meta.url), 'utf8');
  assert.match(app, /import \{ csvCell \} from '\.\/lib\/csv\.mjs'/);
  assert.match(intel, /import \{ csvCell \} from '\.\/lib\/csv\.mjs'/);
  assert.match(operations, /import \{ csvCell \} from '\.\/lib\/csv\.mjs'/);
  assert.doesNotMatch(intel, /function csvCell\(/);
  assert.doesNotMatch(operations, /function csvValue\(/);
  assert.doesNotMatch(operations, /Date\.now\(\)\.toString\(36\).*Math\.random/);
});
