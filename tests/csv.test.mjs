import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvRow } from '../src/lib/csv.mjs';

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
